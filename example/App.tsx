import React, { useState } from 'react';
import { Meld } from '@meldcrypto/react-native-sdk';
import { CONFIG, ORDER, needsCustomerField } from './src/config';
import { useQuote } from './src/hooks/useQuote';
import { useBuyFlow } from './src/hooks/useBuyFlow';
import { CheckoutScreen } from './src/components/CheckoutScreen';
import { WidgetScreen } from './src/components/WidgetScreen';

Meld.configure('sandbox'); // or 'production'

// Thin orchestrator: holds the checkout inputs and switches between the checkout and widget
// screens. Everything else lives in src/{api,hooks,components,utils}.
export default function App() {
  const quote = useQuote();
  const { order, busy, error: buyError, buy, closeOrder } = useBuyFlow();
  const [wallet, setWallet] = useState(ORDER.defaultWallet);
  const [customerId, setCustomerId] = useState('');

  if (order) {
    return <WidgetScreen order={order} onClose={closeOrder} />;
  }

  return (
    <CheckoutScreen
      wallet={wallet}
      onWalletChange={setWallet}
      customerId={customerId}
      onCustomerIdChange={setCustomerId}
      quote={quote}
      busy={busy}
      error={buyError || quote.configError}
      onBuy={() =>
        buy(
          needsCustomerField ? customerId.trim() : CONFIG.customerId,
          wallet.trim(),
        )
      }
    />
  );
}
