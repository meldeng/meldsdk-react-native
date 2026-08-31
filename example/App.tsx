import React, { useEffect, useState } from 'react';
import { Meld } from '@meldcrypto/react-native-sdk';
import { type PaymentMethodType } from './src/api/meld';
import { CONFIG, ORDER, needsCustomerField } from './src/config';
import { useQuotes } from './src/hooks/useQuote';
import { useBuyFlow } from './src/hooks/useBuyFlow';
import { CheckoutScreen } from './src/components/CheckoutScreen';
import { WidgetScreen } from './src/components/WidgetScreen';

Meld.configure('sandbox'); // or 'production'

// Thin orchestrator: holds the checkout inputs + selected provider and switches between the
// checkout and widget screens. Everything else lives in src/{api,hooks,components,utils}.
export default function App() {
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodType>('CREDIT_DEBIT_CARD');
  const [applePayAvailable, setApplePayAvailable] = useState(false);
  const { quotes, note, configError } = useQuotes(paymentMethod);
  const { order, applePay, busy, error: buyError, buy, closeOrder } = useBuyFlow();

  // Ask the SDK whether this device/user can pay before offering the option, rather than showing
  // a button that could never open a sheet.
  useEffect(() => {
    let cancelled = false;
    Meld.canPresentApplePay().then((ok) => {
      if (cancelled) return;
      setApplePayAvailable(ok);
      if (!ok) setPaymentMethod('CREDIT_DEBIT_CARD');
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const [wallet, setWallet] = useState(ORDER.defaultWallet);
  const [customerId, setCustomerId] = useState('');
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);

  // Default to the best (first) quote once they arrive; keep the user's pick otherwise.
  useEffect(() => {
    setSelectedProvider((prev) =>
      prev && quotes.some((q) => q.serviceProvider === prev)
        ? prev
        : (quotes[0]?.serviceProvider ?? null),
    );
  }, [quotes]);

  if (order) {
    return (
      <WidgetScreen
        order={order}
        applePay={applePay}
        providerName={selectedProvider ?? ''}
        onClose={closeOrder}
      />
    );
  }

  return (
    <CheckoutScreen
      wallet={wallet}
      onWalletChange={setWallet}
      customerId={customerId}
      onCustomerIdChange={setCustomerId}
      quotes={quotes}
      selectedProvider={selectedProvider}
      onSelectProvider={setSelectedProvider}
      note={note}
      busy={busy}
      error={buyError || configError}
      paymentMethod={paymentMethod}
      onSelectPaymentMethod={setPaymentMethod}
      applePayAvailable={applePayAvailable}
      onBuy={() =>
        buy(
          selectedProvider ?? '',
          needsCustomerField ? customerId.trim() : CONFIG.customerId,
          wallet.trim(),
          paymentMethod,
        )
      }
    />
  );
}
