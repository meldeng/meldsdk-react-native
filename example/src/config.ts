import { MELD_API_KEY, MELD_CUSTOMER_ID, MELD_API_HOST } from '@env';

// Credentials come from a gitignored .env (copy .env.example -> .env). ⚠️ POC ONLY — DO NOT
// SHIP: a real app creates the order on its backend so the API key never reaches the device;
// this example calls Meld directly just to stay self-contained.
export const CONFIG = {
  apiKey: MELD_API_KEY,
  customerId: MELD_CUSTOMER_ID,
  apiHost: MELD_API_HOST || 'api-sb.meld.io', // e.g. api-qa.meld.io for QA
  version: '2026-05-01',
};

// Fixed corridor, same as the native demo: 15 USD -> BTC, US, Mercuryo card.
export const ORDER = {
  sourceAmount: '15',
  sourceCurrencyCode: 'USD',
  destinationCurrencyCode: 'BTC',
  countryCode: 'US',
  defaultWallet: 'bc1qr74wmrcwqq9w5yxczxj6udts9mnqsh3xlhk5yp',
};

// The server-held customer id is preferred; show an input only when it isn't set.
export const needsCustomerField = !CONFIG.customerId;

export const PRESETS = ['15', '50', '100', '250', '500'];
