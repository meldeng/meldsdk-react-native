import { useCallback, useState } from 'react';
import {
  createOrder,
  mintRequirementsSession,
  type CreatedOrder,
  type PaymentMethodType,
} from '../api/meld';
import { describe, ensureReady } from '../requirements';

// Owns the created order plus the create-order request state (busy/error). When `order` is set,
// the app shows the widget screen; `closeOrder` returns to checkout.
export function useBuyFlow() {
  const [created, setCreated] = useState<CreatedOrder | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const buy = useCallback(
    async (
      provider: string,
      customer: string,
      wallet: string,
      paymentMethodType: PaymentMethodType,
    ) => {
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
        // Run the provider's requirements first (terms, details, Meld KYC); create only once ready.
        const session = await mintRequirementsSession(
          provider,
          customer,
          paymentMethodType,
        );
        if (session) {
          const result = await ensureReady(session);
          if (result.status !== 'READY' && result.status !== 'UNDETERMINED') {
            setError(describe(result));
            return;
          }
        }
        setCreated(await createOrder(provider, customer, wallet, paymentMethodType));
      } catch (e: any) {
        setError(e.message);
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const closeOrder = useCallback(() => setCreated(null), []);

  return {
    order: created?.order ?? null,
    applePay: created?.applePay,
    busy,
    error,
    buy,
    closeOrder,
  };
}
