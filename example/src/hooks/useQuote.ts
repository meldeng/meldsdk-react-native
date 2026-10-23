import { useEffect, useState } from 'react';
import { Meld } from '@meldcrypto/react-native-sdk';
import { CONFIG } from '../config';
import { fetchQuotes, type PaymentMethodType, type Quote } from '../api/meld';

// Ask the SDK whether this device can pay with each quote row before offering it, rather than
// showing a provider whose sheet could never open. 'unknown' rows are still offered.
export async function presentable(quotes: Quote[]): Promise<Quote[]> {
  const offered = await Promise.all(
    quotes.map(async (q) => {
      if (!q.paymentMethodType || !q.headlessPresentation) return true;
      const readiness = await Meld.presentationReadiness({
        paymentMethodType: q.paymentMethodType,
        headlessPresentation: q.headlessPresentation,
      });
      return readiness.status !== 'unavailable';
    }),
  );
  return quotes.filter((_, i) => offered[i]);
}

export interface QuotesState {
  quotes: Quote[];
  note: string;
  /** Set when the demo can't run at all (e.g. no API key) — surfaced on the checkout screen. */
  configError: string;
}

// Fetches one live quote per headless-capable provider for the chosen payment method — the
// providers that can serve a card order are not the same set that can serve Apple Pay, so this
// re-runs when the method changes.
export function useQuotes(
  paymentMethodType: PaymentMethodType = 'CREDIT_DEBIT_CARD',
): QuotesState {
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [note, setNote] = useState('fetching live quotes…');
  const [configError, setConfigError] = useState('');

  useEffect(() => {
    (async () => {
      if (!CONFIG.apiKey) {
        setNote('MELD_API_KEY not set');
        setConfigError(
          'MELD_API_KEY is empty. Fill .env (see README), then restart Metro with --reset-cache.',
        );
        return;
      }
      try {
        const all = await fetchQuotes(paymentMethodType);
        const q = await presentable(all);
        const hidden = all.length - q.length;
        setQuotes(q);
        setNote(
          `${q.length} provider${q.length === 1 ? '' : 's'}: ` +
            q.map((x) => x.serviceProvider).join(', ') +
            (hidden ? ` (${hidden} not available on this device)` : ''),
        );
      } catch (e: any) {
        setNote(`quote failed: ${e.message}`);
      }
    })();
  }, [paymentMethodType]);

  return { quotes, note, configError };
}
