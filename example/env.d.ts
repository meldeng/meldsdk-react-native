// Types for the values injected from .env by react-native-dotenv.
declare module '@env' {
  export const MELD_API_KEY: string;
  export const MELD_CUSTOMER_ID: string;
  export const MELD_API_HOST: string;
  // Optional corridor overrides — see config.ts for why the default is a EU corridor.
  export const MELD_SOURCE_CURRENCY: string;
  export const MELD_DEST_CURRENCY: string;
  export const MELD_COUNTRY: string;
  export const MELD_WALLET: string;
}
