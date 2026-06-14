import { useEffect, useState } from 'react';
import { CONFIG, ORDER } from '../config';
import { fetchQuote } from '../api/meld';
import { format } from '../utils/format';

export interface QuoteState {
  receiveText: string;
  quoteNote: string;
  rateText: string;
  /** Set when the demo can't run at all (e.g. no API key) — surfaced on the checkout screen. */
  configError: string;
}

// Fetches a live quote on mount, purely for display on the checkout screen.
export function useQuote(): QuoteState {
  const [receiveText, setReceiveText] = useState('…');
  const [quoteNote, setQuoteNote] = useState('fetching live quote…');
  const [rateText, setRateText] = useState('Credit / debit card rail');
  const [configError, setConfigError] = useState('');

  useEffect(() => {
    (async () => {
      if (!CONFIG.apiKey) {
        setReceiveText('≈ —');
        setQuoteNote('MELD_API_KEY not set');
        setConfigError(
          'MELD_API_KEY is empty. Fill .env (see README), then restart Metro with --reset-cache.',
        );
        return;
      }
      try {
        const q = await fetchQuote();
        if (q.destinationAmount != null)
          setReceiveText(`≈ ${format(q.destinationAmount)}`);
        if (q.totalFee != null)
          setQuoteNote(
            `live quote — total fees ${format(q.totalFee)} ${
              ORDER.sourceCurrencyCode
            }`,
          );
        if (q.exchangeRate != null)
          setRateText(
            `1 BTC ≈ ${Math.round(q.exchangeRate).toLocaleString()} ${
              ORDER.sourceCurrencyCode
            }`,
          );
      } catch (e: any) {
        setReceiveText('≈ —');
        setQuoteNote(`quote failed: ${e.message}`);
      }
    })();
  }, []);

  return { receiveText, quoteNote, rateText, configError };
}
