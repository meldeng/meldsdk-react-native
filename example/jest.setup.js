/* eslint-env jest */
// The native MeldModule only exists on a device/simulator. Stub it so the JS SDK
// (Meld.configure / Meld.capabilities) is callable under jest.
import { NativeModules } from 'react-native';

NativeModules.MeldModule = {
  configure: jest.fn(),
  capabilities: jest.fn(() =>
    Promise.resolve({ embeddable: true, surface: 'native', requiresUserGesture: false }),
  ),
  // Jest's RN preset reports Platform.OS as 'ios', so Meld.canPresentApplePay() gets past its
  // platform guard and calls straight through to the native module. Every method the app touches
  // has to be stubbed here or the call is a TypeError, not a false.
  canPresentApplePay: jest.fn(() => Promise.resolve(true)),
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
