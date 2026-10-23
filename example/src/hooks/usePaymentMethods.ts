import { useEffect, useState } from 'react';
import { Meld } from '@meldcrypto/react-native-sdk';
import { type PaymentMethodType } from '../api/meld';

const METHODS: PaymentMethodType[] = ['CREDIT_DEBIT_CARD', 'APPLE_PAY'];

// Ask the SDK whether this device can pay with each method before quoting it, so Apple Pay is not
// offered on Android or on an iPhone without a usable Wallet card. 'unknown' methods are offered.
export async function offeredMethods(
  methods: PaymentMethodType[] = METHODS,
): Promise<PaymentMethodType[]> {
  const readiness = await Promise.all(
    methods.map((m) => Meld.paymentMethodReadiness(m)),
  );
  return methods.filter((_, i) => readiness[i].status !== 'unavailable');
}

// Cards until the device has answered, so a method it cannot use is never shown.
export function usePaymentMethods(): PaymentMethodType[] {
  const [methods, setMethods] = useState<PaymentMethodType[]>([
    'CREDIT_DEBIT_CARD',
  ]);
  useEffect(() => {
    let live = true;
    offeredMethods().then((m) => live && setMethods(m));
    return () => {
      live = false;
    };
  }, []);
  return methods;
}
