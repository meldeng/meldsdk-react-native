import {
  MELD_API_KEY,
  MELD_CUSTOMER_ID,
  MELD_API_HOST,
  MELD_SOURCE_CURRENCY,
  MELD_DEST_CURRENCY,
  MELD_COUNTRY,
  MELD_WALLET,
} from '@env';

// Credentials come from a gitignored .env (copy .env.example -> .env). ⚠️ POC ONLY — DO NOT
// SHIP: a real app creates the order on its backend so the API key never reaches the device;
// this example calls Meld directly just to stay self-contained.
export const CONFIG = {
  apiKey: MELD_API_KEY,
  customerId: MELD_CUSTOMER_ID,
  apiHost: MELD_API_HOST || 'api-sb.meld.io', // e.g. api-qa.meld.io for QA
  version: '2026-05-01',
};

// Corridor for the demo, overridable from .env — because no single corridor exercises both
// payment methods:
//
//   Apple Pay (native)  Mercuryo does NOT process US or GB users, so a US corridor never returns a
//                       native Apple Pay quote. The default below is EU so this lane works.
//   Apple Pay (hosted)  Coinbase's guest checkout is US-centric — set MELD_COUNTRY=US to get it.
//   Card                quotes on the US corridor (USD -> USDC with an 0x wallet).
//
// So: leave the defaults to reach a native PassKit sheet; set the US overrides below to exercise
// the card widget or the provider-hosted Apple Pay page.
//
//   MELD_SOURCE_CURRENCY=USD MELD_DEST_CURRENCY=USDC MELD_COUNTRY=US \
//   MELD_WALLET=0x4838B106FCe9647Bdf1E7877BF73cE8B0BAD5f97
export const ORDER = {
  sourceAmount: '15',
  sourceCurrencyCode: MELD_SOURCE_CURRENCY || 'EUR',
  destinationCurrencyCode: MELD_DEST_CURRENCY || 'BTC',
  countryCode: MELD_COUNTRY || 'FR',
  defaultWallet: MELD_WALLET || 'bc1qr74wmrcwqq9w5yxczxj6udts9mnqsh3xlhk5yp',
};

// The server-held customer id is preferred; show an input only when it isn't set.
export const needsCustomerField = !CONFIG.customerId;

export const PRESETS = ['15', '50', '100', '250', '500'];
