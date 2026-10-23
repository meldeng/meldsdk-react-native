/* eslint-env jest */
// The native MeldModule only exists on a device/simulator. Stub it so the JS SDK
// (Meld.configure / Meld.capabilities) is callable under jest.
import { NativeModules } from 'react-native';

NativeModules.MeldModule = {
  configure: jest.fn(),
  capabilities: jest.fn(() =>
    Promise.resolve({ embeddable: true, surface: 'native', requiresUserGesture: false }),
  ),
  // Every method the app touches has to be stubbed here or the call is a TypeError.
  presentationReadiness: jest.fn(() => Promise.resolve({ status: 'ready' })),
  paymentMethodReadiness: jest.fn(() => Promise.resolve({ status: 'unknown' })),
};

// Keep the test hermetic: never hit the real Meld API (the on-mount quote fetch would
// otherwise depend on a local .env and leak a pending request past teardown).
global.fetch = jest.fn(() =>
  Promise.resolve({
    ok: true,
    json: () =>
      Promise.resolve({
        quotes: [{ destinationAmount: 0.0002, totalFee: 1, exchangeRate: 60000 }],
      }),
  }),
);
