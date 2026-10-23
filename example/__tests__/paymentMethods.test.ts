import { NativeModules } from 'react-native';
import { offeredMethods } from '../src/hooks/usePaymentMethods';

afterEach(() => {
  NativeModules.MeldModule.paymentMethodReadiness.mockClear();
});

test('the checkout leaves out a payment method this device cannot use', async () => {
  NativeModules.MeldModule.paymentMethodReadiness.mockImplementation(
    (method: string) =>
      Promise.resolve(
        method === 'APPLE_PAY'
          ? { status: 'unavailable', code: 'PAYMENT_METHOD_UNAVAILABLE' }
          : { status: 'unknown' },
      ),
  );
  expect(await offeredMethods()).toEqual(['CREDIT_DEBIT_CARD']);
  expect(NativeModules.MeldModule.paymentMethodReadiness).toHaveBeenCalledTimes(2);
  expect(NativeModules.MeldModule.paymentMethodReadiness).toHaveBeenCalledWith('APPLE_PAY');
});

test('the checkout offers ready and unknown payment methods', async () => {
  NativeModules.MeldModule.paymentMethodReadiness.mockImplementation(
    (method: string) =>
      Promise.resolve({ status: method === 'APPLE_PAY' ? 'ready' : 'unknown' }),
  );
  expect(await offeredMethods()).toEqual(['CREDIT_DEBIT_CARD', 'APPLE_PAY']);
});
