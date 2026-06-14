import { useCallback, useState } from 'react';
import { createOrder, type Order } from '../api/meld';

// Owns the created order plus the create-order request state (busy/error). When `order` is set,
// the app shows the widget screen; `closeOrder` returns to checkout.
export function useBuyFlow() {
  const [order, setOrder] = useState<Order | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const buy = useCallback(async (customer: string, wallet: string) => {
    setError('');
    setBusy(true);
    try {
      if (!customer) {
        setError('Set a Meld customer ID.');
        return;
      }
      const created = await createOrder(customer, wallet);
      setOrder(created);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }, []);

  const closeOrder = useCallback(() => setOrder(null), []);

  return { order, busy, error, buy, closeOrder };
}
