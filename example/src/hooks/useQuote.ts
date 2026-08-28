import { useEffect, useState } from 'react';
import { CONFIG } from '../config';
import { fetchQuotes, type PaymentMethodType, type Quote } from '../api/meld';

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
        const q = await fetchQuotes(paymentMethodType);
        setQuotes(q);
        setNote(
          `${q.length} provider${q.length === 1 ? '' : 's'}: ` +
            q.map((x) => x.serviceProvider).join(', '),
        );
      } catch (e: any) {
        setNote(`quote failed: ${e.message}`);
      }
    })();
  }, [paymentMethodType]);

  return { quotes, note, configError };
}
