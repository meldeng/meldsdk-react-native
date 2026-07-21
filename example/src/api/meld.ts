import { type MeldOrder } from '@meldcrypto/react-native-sdk';
import { CONFIG, ORDER } from '../config';
import { uuidv4 } from '../utils/uuid';

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
export async function fetchQuotes(): Promise<Quote[]> {
  const body: Record<string, unknown> = {
    countryCode: ORDER.countryCode,
    sourceAmount: ORDER.sourceAmount,
    sourceCurrencyCode: ORDER.sourceCurrencyCode,
    destinationCurrencyCode: ORDER.destinationCurrencyCode,
    paymentMethodType: 'CREDIT_DEBIT_CARD',
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
): Promise<MeldOrder> {
  const res = await post('/crypto/order/headless/onramp', {
    customerId,
    externalOrderId: `rn-demo-${Date.now()}`,
    serviceProvider,
    paymentMethodType: 'CREDIT_DEBIT_CARD',
    sourceCurrencyCode: ORDER.sourceCurrencyCode,
    sourceAmount: ORDER.sourceAmount,
    destinationCurrencyCode: ORDER.destinationCurrencyCode,
    destinationWalletAddress: wallet,
    countryCode: ORDER.countryCode,
    clientIpAddress: await publicIP(),
  });
  const json = await res.json();
  if (!res.ok)
    throw new Error(
      `${json.code ?? res.status} — ${json.message ?? 'order creation failed'}`,
    );
  return json;
}
