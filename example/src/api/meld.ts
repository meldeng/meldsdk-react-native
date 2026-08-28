import {
  type MeldApplePayRequest,
  type MeldOrder,
} from '@meldcrypto/react-native-sdk';
import { CONFIG, ORDER } from '../config';
import { uuidv4 } from '../utils/uuid';

/** The two surfaces this demo can drive. Both go through the same `<MeldWidget>`. */
export type PaymentMethodType = 'CREDIT_DEBIT_CARD' | 'APPLE_PAY';

/** An order plus, for Apple Pay, what the sheet needs beyond it. */
export interface CreatedOrder {
  order: MeldOrder;
  applePay?: MeldApplePayRequest;
}

export interface Quote {
  serviceProvider: string;
  destinationAmount?: number;
  totalFee?: number;
  exchangeRate?: number;
  kycMode?: string;
}

async function publicIP(): Promise<string | undefined> {
  try {
    const r = await fetch('https://api64.ipify.org?format=json');
    return (await r.json()).ip;
  } catch {
    return undefined;
  }
}

// POC stand-in for your backend — sets the Meld auth/version/idempotency headers.
function post(path: string, body: object): Promise<Response> {
  return fetch(`https://${CONFIG.apiHost}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `BASIC ${CONFIG.apiKey}`,
      'Meld-Version': CONFIG.version,
      'X-Idempotency-Key': uuidv4(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

// One quote per headless-capable provider for the corridor (no `serviceProviders` filter), so the
// user can pick which provider to use — same as the iOS/Android/web demos.
export async function fetchQuotes(
  paymentMethodType: PaymentMethodType = 'CREDIT_DEBIT_CARD',
): Promise<Quote[]> {
  const body: Record<string, unknown> = {
    countryCode: ORDER.countryCode,
    sourceAmount: ORDER.sourceAmount,
    sourceCurrencyCode: ORDER.sourceCurrencyCode,
    destinationCurrencyCode: ORDER.destinationCurrencyCode,
    paymentMethodType,
  };
  // Providers that quote on-behalf-of a customer (e.g. Uphold) require the customer id on the quote
  // itself, so the provider can resolve that customer's service-provider identity.
  if (CONFIG.customerId) body.customerId = CONFIG.customerId;

  const res = await post('/payments/crypto/quote?integrationMode=HEADLESS', body);
  const json = await res.json();
  const quotes: Quote[] = (json.quotes || []).filter(
    (q: Quote) => q && q.serviceProvider,
  );
  if (!quotes.length) throw new Error(json.message || 'no quotes returned');
  // Best (most crypto for the money) first, so the default selection is the strongest quote.
  return quotes.sort(
    (a, b) => Number(b.destinationAmount) - Number(a.destinationAmount),
  );
}

export async function createOrder(
  serviceProvider: string,
  customerId: string,
  wallet: string,
  paymentMethodType: PaymentMethodType = 'CREDIT_DEBIT_CARD',
): Promise<CreatedOrder> {
  // The SAME device IP has to reach order creation and the Apple Pay sheet — providers bind the
  // transaction to it — so it is resolved once here and handed back with the order.
  const clientIpAddress = await publicIP();
  const res = await post('/crypto/order/headless/onramp', {
    customerId,
    externalOrderId: `rn-demo-${Date.now()}`,
    serviceProvider,
    paymentMethodType,
    sourceCurrencyCode: ORDER.sourceCurrencyCode,
    sourceAmount: ORDER.sourceAmount,
    destinationCurrencyCode: ORDER.destinationCurrencyCode,
    destinationWalletAddress: wallet,
    countryCode: ORDER.countryCode,
    clientIpAddress,
  });
  const json = await res.json();
  if (!res.ok)
    throw new Error(
      `${json.code ?? res.status} — ${json.message ?? 'order creation failed'}`,
    );

  // Apple Pay orders need a few inputs the order itself doesn't carry. Build it for every Apple
  // Pay order regardless of provider: the SDK ignores it for a provider-hosted surface, so the
  // caller never has to know which shape it got.
  const applePay: MeldApplePayRequest | undefined =
    paymentMethodType === 'APPLE_PAY'
      ? {
          amount: ORDER.sourceAmount,
          currencyCode: ORDER.sourceCurrencyCode,
          walletAddress: wallet,
          clientIpAddress: clientIpAddress ?? '',
          summaryItemLabel: `Meld demo — Buy ${ORDER.destinationCurrencyCode}`,
        }
      : undefined;

  return { order: json, applePay };
}
