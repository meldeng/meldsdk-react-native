import { type MeldOrder } from '@meldcrypto/react-native-sdk';
import { CONFIG, ORDER } from '../config';
import { uuidv4 } from '../utils/uuid';

export interface Quote {
  destinationAmount?: number;
  totalFee?: number;
  exchangeRate?: number;
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

export async function fetchQuote(): Promise<Quote> {
  const res = await post('/payments/crypto/quote?integrationMode=HEADLESS', {
    countryCode: ORDER.countryCode,
    sourceAmount: ORDER.sourceAmount,
    sourceCurrencyCode: ORDER.sourceCurrencyCode,
    destinationCurrencyCode: ORDER.destinationCurrencyCode,
    paymentMethodType: 'CREDIT_DEBIT_CARD',
    serviceProviders: ['MERCURYO'],
  });
  const json = await res.json();
  const q = (json.quotes || [])[0];
  if (!q) throw new Error(json.message || 'no quotes returned');
  return q;
}

export async function createOrder(
  customerId: string,
  wallet: string,
): Promise<MeldOrder> {
  const res = await post('/crypto/order/headless', {
    customerId,
    externalOrderId: `rn-demo-${Date.now()}`,
    sessionType: 'BUY',
    serviceProvider: 'MERCURYO',
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
