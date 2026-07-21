import { useCallback, useState } from 'react';
import { type MeldOrder } from '@meldcrypto/react-native-sdk';
import { createOrder } from '../api/meld';

// Owns the created order plus the create-order request state (busy/error). When `order` is set,
// the app shows the widget screen; `closeOrder` returns to checkout.
export function useBuyFlow() {
  const [order, setOrder] = useState<MeldOrder | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const buy = useCallback(
    async (provider: string, customer: string, wallet: string) => {
      setError('');
      setBusy(true);
      try {
        if (!provider) {
          setError('Pick a provider first.');
          return;
        }
        if (!customer) {
          setError('Set a Meld customer ID.');
          return;
        }
        const created = await createOrder(provider, customer, wallet);
        setOrder(created);
      } catch (e: any) {
        setError(e.message);
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const closeOrder = useCallback(() => setOrder(null), []);

  return { order, busy, error, buy, closeOrder };
}
