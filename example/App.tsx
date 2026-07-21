import React, { useEffect, useState } from 'react';
import { Meld } from '@meldcrypto/react-native-sdk';
import { CONFIG, ORDER, needsCustomerField } from './src/config';
import { useQuotes } from './src/hooks/useQuote';
import { useBuyFlow } from './src/hooks/useBuyFlow';
import { CheckoutScreen } from './src/components/CheckoutScreen';
import { WidgetScreen } from './src/components/WidgetScreen';

Meld.configure('sandbox'); // or 'production'

// Thin orchestrator: holds the checkout inputs + selected provider and switches between the
// checkout and widget screens. Everything else lives in src/{api,hooks,components,utils}.
export default function App() {
  const { quotes, note, configError } = useQuotes();
  const { order, busy, error: buyError, buy, closeOrder } = useBuyFlow();
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
      onBuy={() =>
        buy(
          selectedProvider ?? '',
          needsCustomerField ? customerId.trim() : CONFIG.customerId,
          wallet.trim(),
        )
      }
    />
  );
}
