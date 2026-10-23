import { NativeModules } from 'react-native';
import { presentable } from '../src/hooks/useQuote';

const card = { surface: 'EMBEDDED_WIDGET', protocol: 'MERCURYO_WIDGET', version: 1 };
const wallet = { surface: 'NATIVE_TOKEN', protocol: 'MELD_WALLET_TOKEN', version: 1 };

afterEach(() => {
  delete NativeModules.MeldModule.headlessProtocolVersion;
  NativeModules.MeldModule.presentationReadiness.mockClear();
});

test('the checkout offers only the quote rows this device can present', async () => {
  NativeModules.MeldModule.headlessProtocolVersion = 1;
  NativeModules.MeldModule.presentationReadiness.mockImplementation(
    (_method: string, presentation: { protocol: string }) =>
      Promise.resolve(
        presentation.protocol === 'MELD_WALLET_TOKEN'
          ? { status: 'unavailable', code: 'PAYMENT_METHOD_UNAVAILABLE' }
          : { status: 'unknown' },
      ),
  );
  const quotes = [
    { serviceProvider: 'WALLET', paymentMethodType: 'APPLE_PAY', headlessPresentation: wallet },
    { serviceProvider: 'CARD', paymentMethodType: 'CREDIT_DEBIT_CARD', headlessPresentation: card },
    { serviceProvider: 'UNDECLARED' },
  ];
  const offered = await presentable(quotes);
  expect(offered.map((q) => q.serviceProvider)).toEqual(['CARD', 'UNDECLARED']);
  expect(NativeModules.MeldModule.presentationReadiness).toHaveBeenCalledTimes(2);
  expect(NativeModules.MeldModule.presentationReadiness).toHaveBeenCalledWith('APPLE_PAY', wallet);
});
