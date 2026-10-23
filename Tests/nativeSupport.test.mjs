import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canMountOrder, inspectCapabilities, inspectPaymentMethodReadiness, inspectPresentationCapabilities, inspectPresentationReadiness,
  isNativeBridgeAvailable, presentationOf,
} from '../src/nativeSupport.ts';

const declared = { id: 'synthetic', headlessPresentation: { surface: 'NATIVE_SDK', protocol: 'SYNTHETIC', version: 1 }, paymentActions: { version: 1 } };
const caps = { embeddable: false, surface: 'native-sdk', requiresUserGesture: true };

test('an OTA bundle cannot dispatch declared orders through an old native resolver', async () => {
  for (const version of [undefined, null, true, '1', 0, 2]) {
    const bridge = { headlessProtocolVersion: version, capabilities() { assert.fail('Must not reach old native code'); } };
    assert.equal(canMountOrder(declared, bridge), false);
    assert.equal((await inspectCapabilities(declared, bridge)).surface, 'unsupported');
  }
});

const legacyDeclared = [
  ['CREDIT_DEBIT_CARD', 'EMBEDDED_WIDGET', 'MERCURYO_WIDGET'],
  ['CREDIT_DEBIT_CARD', 'EMBEDDED_WIDGET', 'UPHOLD_WIDGET'],
  ['CREDIT_DEBIT_CARD', 'VENDOR_SDK', 'BANXA_CHECKOUT'],
  ['APPLE_PAY', 'VENDOR_SDK', 'BANXA_CHECKOUT'],
  ['APPLE_PAY', 'PROVIDER_HOSTED', 'COINBASE_APPLE_PAY'],
  ['APPLE_PAY', 'NATIVE_TOKEN', 'MELD_WALLET_TOKEN'],
].map(([paymentMethodType, surface, protocol]) => ({
  id: 'synthetic', paymentMethodType, headlessPresentation: { surface, protocol, version: 1 },
}));
const registryOnly = [
  { id: 'synthetic', paymentMethodType: 'APPLE_PAY',
    headlessPresentation: { surface: 'NATIVE_SDK', protocol: 'STRIPE_CRYPTO_ONRAMP', version: 1 } },
  { id: 'synthetic', paymentMethodType: 'CREDIT_DEBIT_CARD',
    headlessPresentation: { surface: 'NATIVE_SDK', protocol: 'STRIPE_CRYPTO_ONRAMP', version: 1 } },
  { id: 'synthetic', paymentMethodType: 'CREDIT_DEBIT_CARD',
    headlessPresentation: { surface: 'EMBEDDED_WIDGET', protocol: 'MERCURYO_WIDGET', version: 2 } },
  { id: 'synthetic', paymentMethodType: 'APPLE_PAY',
    headlessPresentation: { surface: 'EMBEDDED_WIDGET', protocol: 'MERCURYO_WIDGET', version: 1 } },
  { id: 'synthetic', headlessPresentation: { surface: 'EMBEDDED_WIDGET', protocol: 'MERCURYO_WIDGET', version: 1 } },
  { id: 'synthetic', paymentMethodType: 'CREDIT_DEBIT_CARD',
    headlessPresentation: { surface: 'EMBEDDED_WIDGET', protocol: 'MERCURYO_WIDGET', version: '1' } },
  { id: 'synthetic', paymentMethodType: 'APPLE_PAY', headlessPresentation: null },
];

test('an Android or pre-0.8 iOS bridge mounts the declarations its legacy dispatch presents', async () => {
  for (const order of legacyDeclared) {
    for (const headlessProtocolVersion of [undefined, 0]) {
      const bridge = { headlessProtocolVersion, async capabilities(value) {
        assert.equal(value, order); return { embeddable: true, surface: 'embedded', requiresUserGesture: false };
      } };
      assert.equal(canMountOrder(order, bridge), true, order.headlessPresentation.protocol);
      assert.equal((await inspectCapabilities(order, bridge)).surface, 'embedded');
    }
  }
});

test('a pre-0.8 bridge refuses registry-only declarations before reaching native code', async () => {
  const bridge = { capabilities() { assert.fail('Must not reach old native code'); } };
  for (const order of registryOnly) {
    assert.equal(canMountOrder(order, bridge), false, JSON.stringify(order.headlessPresentation));
    assert.equal((await inspectCapabilities(order, bridge)).surface, 'unsupported');
  }
});

test('a registry bridge receives every declaration, including ones it will refuse', async () => {
  for (const order of [...legacyDeclared, ...registryOnly, declared]) {
    const bridge = { headlessProtocolVersion: 1, async capabilities(value) { assert.equal(value, order); return caps; } };
    assert.equal(canMountOrder(order, bridge), true);
    assert.deepEqual(await inspectCapabilities(order, bridge), caps);
  }
});

test('opaque declared order and capabilities pass through a compatible native bridge', async () => {
  const bridge = { headlessProtocolVersion: 1, async capabilities(order) { assert.equal(order, declared); return caps; } };
  assert.equal(canMountOrder(declared, bridge), true);
  assert.deepEqual(await inspectCapabilities(declared, bridge), caps);
});

test('legacy orders remain supported while absent or malformed bridges fail closed', async () => {
  const bridge = { async capabilities() { return { ...caps, surface: 'iframe', embeddable: true }; } };
  assert.equal(canMountOrder({ id: 'legacy' }, bridge), true);
  assert.equal(canMountOrder({ headlessPresentation: null }, bridge), false);
  for (const missing of [null, undefined, {}, { capabilities: 'not-a-function' }]) {
    assert.equal((await inspectCapabilities(declared, missing)).surface, 'unsupported');
  }
  for (const bad of [null, {}, { ...caps, embeddable: 'false' }, { ...caps, surface: '' }]) {
    assert.equal((await inspectCapabilities(declared, { headlessProtocolVersion: 1, async capabilities() { return bad; } })).surface, 'unsupported');
  }
});

const presentation = { surface: 'FUTURE_SURFACE', protocol: 'FUTURE_PROTOCOL', version: 3 };

test('preflight forwards method and opaque descriptor to the installed native registry', async () => {
  const bridge = { headlessProtocolVersion: 1, async presentationCapabilities(method, value) {
    assert.equal(method, 'APPLE_PAY'); assert.equal(value, presentation); return caps;
  }, capabilities() { assert.fail('Preflight must not fabricate an order'); } };
  assert.deepEqual(await inspectPresentationCapabilities('APPLE_PAY', presentation, bridge), caps);
});

test('preflight fails closed on missing operation and incompatible native versions', async () => {
  for (const version of [undefined, null, true, '1', 0, 2]) {
    const bridge = { headlessProtocolVersion: version, presentationCapabilities() { assert.fail('Old native bridge'); } };
    assert.equal((await inspectPresentationCapabilities('APPLE_PAY', presentation, bridge)).surface, 'unsupported');
  }
  for (const bridge of [null, undefined, {}, { headlessProtocolVersion: 1 },
    { headlessProtocolVersion: 1, presentationCapabilities: 'wrong' }]) {
    assert.equal((await inspectPresentationCapabilities('APPLE_PAY', presentation, bridge)).surface, 'unsupported');
  }
});

test('malformed descriptor and method never cross the native bridge', async () => {
  const bridge = { headlessProtocolVersion: 1, presentationCapabilities() { assert.fail('Malformed input'); } };
  for (const malformed of [null, undefined, [], {}, true, 'invalid',
    ...[true, '1', null, 0, -1, 1.5, 2147483648, NaN, Infinity].map(version => ({ ...presentation, version })),
    ...['', 'NATIVE_SDK\n', 'NATIVE_SDK\r', 'NATIVE_SDK\u2028', 'native_sdk', 'A'.repeat(65)]
      .flatMap(value => [{ ...presentation, surface: value }, { ...presentation, protocol: value }])]) {
    assert.equal((await inspectPresentationCapabilities('APPLE_PAY', malformed, bridge)).surface, 'unsupported');
  }
  for (const method of [null, undefined, true, '', 'apple_pay', 'APPLE_PAY ', 'APPLE_PAY\n']) {
    assert.equal((await inspectPresentationCapabilities(method, presentation, bridge)).surface, 'unsupported');
  }
});

test('preflight validates native capability output and preserves unsupported results', async () => {
  for (const response of [null, {}, true, { ...caps, embeddable: 'false' }, { ...caps, surface: '' },
    { ...caps, requiresUserGesture: 1 }]) {
    const bridge = { headlessProtocolVersion: 1, async presentationCapabilities() { return response; } };
    assert.equal((await inspectPresentationCapabilities('APPLE_PAY', presentation, bridge)).surface, 'unsupported');
  }
  const unsupported = { embeddable: false, surface: 'unsupported', requiresUserGesture: false };
  const bridge = { headlessProtocolVersion: 1, async presentationCapabilities() { return unsupported; } };
  assert.deepEqual(await inspectPresentationCapabilities('APPLE_PAY', presentation, bridge), unsupported);
});

test('preflight success cannot bypass subsequent order inspection', async () => {
  const unsupported = { embeddable: false, surface: 'unsupported', requiresUserGesture: false };
  const bridge = { headlessProtocolVersion: 1, async presentationCapabilities() { return caps; },
    async capabilities() { return unsupported; } };
  assert.equal((await inspectPresentationCapabilities('APPLE_PAY', presentation, bridge)).surface, 'native-sdk');
  assert.deepEqual(await inspectCapabilities(declared, bridge), unsupported);
});

const googlePay = { surface: 'PROVIDER_HOSTED', protocol: 'COINBASE_PAYMENT_LINK', version: 1 };
const googlePayOrder = { id: 'synthetic', paymentMethodType: 'GOOGLE_PAY', headlessPresentation: googlePay,
  paymentMethodResponseDetails: { paymentLinkUrl: 'https://pay.coinbase.com/synthetic' } };
const wallet = { embeddable: false, surface: 'native-wallet', requiresUserGesture: true };

test('the native module is available on iOS and Android only, and only with a capabilities method', () => {
  const bridge = { capabilities() {} };
  for (const platform of ['ios', 'android']) assert.equal(isNativeBridgeAvailable(platform, bridge), true);
  for (const platform of ['web', 'windows', 'macos']) assert.equal(isNativeBridgeAvailable(platform, bridge), false);
  for (const missing of [null, undefined, {}, { capabilities: true }]) {
    assert.equal(isNativeBridgeAvailable('android', missing), false);
  }
});

test('a registry bridge receives a declared Google Pay order and its quote descriptor', async () => {
  const bridge = { headlessProtocolVersion: 1,
    async presentationCapabilities(method, value) { assert.equal(method, 'GOOGLE_PAY'); assert.equal(value, googlePay); return wallet; },
    async capabilities(order) { assert.equal(order, googlePayOrder); return wallet; } };
  assert.equal(canMountOrder(googlePayOrder, bridge), true);
  assert.deepEqual(await inspectCapabilities(googlePayOrder, bridge), wallet);
  assert.deepEqual(await inspectPresentationCapabilities('GOOGLE_PAY', googlePay, bridge), wallet);
});

test('a bridge without the registry refuses Google Pay before reaching native code', async () => {
  for (const headlessProtocolVersion of [undefined, 0]) {
    const bridge = { headlessProtocolVersion, capabilities() { assert.fail('Must not reach old native code'); },
      presentationCapabilities() { assert.fail('Must not reach old native code'); } };
    assert.equal(canMountOrder(googlePayOrder, bridge), false);
    assert.equal((await inspectCapabilities(googlePayOrder, bridge)).surface, 'unsupported');
    assert.equal((await inspectPresentationCapabilities('GOOGLE_PAY', googlePay, bridge)).surface, 'unsupported');
  }
});

const row = { paymentMethodType: 'GOOGLE_PAY', headlessPresentation: googlePay, serviceProvider: 'SYNTHETIC', sourceAmount: 10 };
const noDeviceCheck = 'This payment method has no device check; offer it and let the payment decide.';

test('a quote row and the positional form name the same method and descriptor', async () => {
  assert.deepEqual(presentationOf(row), ['GOOGLE_PAY', googlePay]);
  assert.deepEqual(presentationOf(row, presentation), ['GOOGLE_PAY', googlePay]);
  assert.deepEqual(presentationOf('GOOGLE_PAY', googlePay), ['GOOGLE_PAY', googlePay]);
  assert.deepEqual(presentationOf(null, googlePay), [null, googlePay]);
  const bridge = { headlessProtocolVersion: 1, async presentationCapabilities(...args) {
    assert.equal(args.length, 2); assert.equal(args[0], 'GOOGLE_PAY'); assert.equal(args[1], googlePay); return wallet;
  } };
  assert.deepEqual(await inspectPresentationCapabilities(...presentationOf(row), bridge), wallet);
  for (const malformed of [{}, { paymentMethodType: 'GOOGLE_PAY' }, { ...row, headlessPresentation: null },
    { ...row, paymentMethodType: 'google_pay' }]) {
    const refusing = { headlessProtocolVersion: 1, presentationCapabilities() { assert.fail('Malformed row'); } };
    assert.equal((await inspectPresentationCapabilities(...presentationOf(malformed), refusing)).surface, 'unsupported');
  }
});

test('readiness forwards only the row\'s method and descriptor and keeps the native answer', async () => {
  for (const [answer, expected] of [
    [{ status: 'ready' }, { status: 'ready' }],
    [{ status: 'ready', code: 'PAYMENT_METHOD_UNAVAILABLE', reason: 'ignored' }, { status: 'ready' }],
    [{ status: 'unavailable', code: 'PAYMENT_METHOD_UNAVAILABLE', reason: 'No card.' },
      { status: 'unavailable', code: 'PAYMENT_METHOD_UNAVAILABLE', reason: 'No card.' }],
    [{ status: 'unknown', reason: 'No answer within 5000 ms.' }, { status: 'unknown', reason: 'No answer within 5000 ms.' }],
    [{ status: 'unknown', reason: '' }, { status: 'unknown' }],
    [{ status: 'unknown', reason: 42 }, { status: 'unknown' }],
    [{ status: 'unavailable', code: 'PAYMENT_METHOD_UNAVAILABLE', detail: 'No card.' },
      { status: 'unavailable', code: 'PAYMENT_METHOD_UNAVAILABLE' }],
    [{ status: 'unknown', detail: 'No answer within 5000 ms.' }, { status: 'unknown' }],
  ]) {
    const bridge = { headlessProtocolVersion: 1, async presentationReadiness(...args) {
      assert.equal(args.length, 2); assert.equal(args[0], 'GOOGLE_PAY'); assert.equal(args[1], googlePay); return answer;
    }, presentationCapabilities() { assert.fail('The native check answers on its own'); } };
    assert.deepEqual(await inspectPresentationReadiness(row, bridge), expected);
  }
});

test('a malformed or failed native readiness answer is unknown, and unavailable always has a code', async () => {
  for (const answer of [null, undefined, true, 'ready', {}, { status: 'READY' }, { status: 'maybe' }]) {
    const bridge = { headlessProtocolVersion: 1, async presentationReadiness() { return answer; } };
    assert.equal((await inspectPresentationReadiness(row, bridge)).status, 'unknown');
  }
  const rejecting = { headlessProtocolVersion: 1, async presentationReadiness() { throw new Error('native failure'); } };
  assert.deepEqual(await inspectPresentationReadiness(row, rejecting), { status: 'unknown', reason: 'The readiness check failed.' });
  for (const code of [undefined, '', 'lower', 42]) {
    const bridge = { headlessProtocolVersion: 1, async presentationReadiness() { return { status: 'unavailable', code }; } };
    assert.deepEqual(await inspectPresentationReadiness(row, bridge), { status: 'unavailable', code: 'PAYMENT_METHOD_UNAVAILABLE' });
  }
});

test('a malformed row is unavailable and never crosses the bridge', async () => {
  const bridge = { headlessProtocolVersion: 1, presentationReadiness() { assert.fail('Malformed row'); },
    presentationCapabilities() { assert.fail('Malformed row'); } };
  for (const malformed of [null, undefined, 'GOOGLE_PAY', {}, { paymentMethodType: 'GOOGLE_PAY' },
    { ...row, headlessPresentation: null }, { ...row, headlessPresentation: { ...googlePay, version: '1' } },
    { ...row, paymentMethodType: 'google_pay' }, { ...row, paymentMethodType: 'GOOGLE_PAY\n' }]) {
    const answer = await inspectPresentationReadiness(malformed, bridge);
    assert.equal(answer.status, 'unavailable');
    assert.equal(answer.code, 'PAYMENT_METHOD_UNAVAILABLE');
  }
});

test('a binary without the registry is unavailable for every row', async () => {
  for (const headlessProtocolVersion of [undefined, null, 0, 2, '1', true]) {
    const bridge = { headlessProtocolVersion, presentationReadiness() { assert.fail('Old native bridge'); },
      presentationCapabilities() { assert.fail('Old native bridge'); } };
    const answer = await inspectPresentationReadiness(row, bridge);
    assert.equal(answer.status, 'unavailable');
    assert.equal(answer.code, 'PAYMENT_METHOD_UNAVAILABLE');
  }
  for (const missing of [null, undefined, {}]) {
    assert.equal((await inspectPresentationReadiness(row, missing)).status, 'unavailable');
  }
});

test('a registry binary without the readiness check answers from presentation support', async () => {
  const applePay = { paymentMethodType: 'APPLE_PAY', headlessPresentation: { surface: 'NATIVE_SDK', protocol: 'STRIPE_CRYPTO_ONRAMP', version: 1 } };
  const supported = { embeddable: false, surface: 'native-applepay', requiresUserGesture: true };
  const unsupportedCaps = { embeddable: false, surface: 'unsupported', requiresUserGesture: false };
  const bridge = (caps) => ({ headlessProtocolVersion: 1, async presentationCapabilities() { return caps; },
    canPresentApplePay() { assert.fail('Removed in 0.10.0'); } });

  const refused = await inspectPresentationReadiness(applePay, bridge(unsupportedCaps));
  assert.equal(refused.status, 'unavailable');
  assert.equal(refused.code, 'PAYMENT_METHOD_UNAVAILABLE');
  assert.deepEqual(await inspectPresentationReadiness(applePay, bridge(supported)),
    { status: 'unknown', reason: noDeviceCheck });
  assert.equal((await inspectPresentationReadiness(row, bridge(wallet))).status, 'unknown');
  const failing = { headlessProtocolVersion: 1, async presentationCapabilities() { throw new Error('native failure'); } };
  assert.deepEqual(await inspectPresentationReadiness(applePay, failing), { status: 'unknown', reason: 'The readiness check failed.' });
});

test('device readiness forwards only the method and keeps the native answer', async () => {
  for (const [answer, expected] of [
    [{ status: 'ready' }, { status: 'ready' }],
    [{ status: 'unavailable', code: 'PAYMENT_METHOD_UNAVAILABLE', reason: 'Google Pay is not available on iOS.' },
      { status: 'unavailable', code: 'PAYMENT_METHOD_UNAVAILABLE', reason: 'Google Pay is not available on iOS.' }],
    [{ status: 'unavailable', code: 'PAYMENT_METHOD_UNAVAILABLE', reason: 'Google Pay has no usable card on this device.' },
      { status: 'unavailable', code: 'PAYMENT_METHOD_UNAVAILABLE', reason: 'Google Pay has no usable card on this device.' }],
    [{ status: 'unavailable' }, { status: 'unavailable', code: 'PAYMENT_METHOD_UNAVAILABLE' }],
    [{ status: 'unknown', reason: noDeviceCheck }, { status: 'unknown', reason: noDeviceCheck }],
    [{ status: 'maybe' }, { status: 'unknown', reason: 'The native readiness answer was malformed.' }],
  ]) {
    for (const platform of ['ios', 'android']) {
      const bridge = { async paymentMethodReadiness(...args) {
        assert.deepEqual(args, ['GOOGLE_PAY']); return answer;
      }, presentationReadiness() { assert.fail('No quote row exists yet'); } };
      assert.deepEqual(await inspectPaymentMethodReadiness('GOOGLE_PAY', platform, bridge), expected);
    }
  }
});

test('device readiness asks the native SDK whatever the protocol version, and a failure is unknown', async () => {
  for (const headlessProtocolVersion of [undefined, 0, 1]) {
    const bridge = { headlessProtocolVersion, async paymentMethodReadiness() { return { status: 'ready' }; } };
    assert.deepEqual(await inspectPaymentMethodReadiness('APPLE_PAY', 'ios', bridge), { status: 'ready' });
  }
  const rejecting = { async paymentMethodReadiness() { throw new Error('native failure'); } };
  assert.deepEqual(await inspectPaymentMethodReadiness('APPLE_PAY', 'ios', rejecting),
    { status: 'unknown', reason: 'The readiness check failed.' });
});

test('a malformed method is unknown and never crosses the bridge', async () => {
  const bridge = { paymentMethodReadiness() { assert.fail('Malformed method'); } };
  for (const method of [null, undefined, true, 42, {}, '', 'apple_pay', 'APPLE_PAY ', 'APPLE_PAY\n', 'A'.repeat(65)]) {
    assert.deepEqual(await inspectPaymentMethodReadiness(method, 'ios', bridge),
      { status: 'unknown', reason: 'The paymentMethodType is malformed.' });
  }
});

test('a binary without the device check rules out only the other platform\'s wallet', async () => {
  const noCheck = { status: 'unknown', reason: noDeviceCheck };
  const oldBridge = { headlessProtocolVersion: 1, async capabilities() {}, presentationReadiness() { assert.fail('Not a row'); } };
  for (const bridge of [oldBridge, {}, null, undefined]) {
    assert.deepEqual(await inspectPaymentMethodReadiness('APPLE_PAY', 'android', bridge),
      { status: 'unavailable', code: 'PAYMENT_METHOD_UNAVAILABLE', reason: 'Apple Pay is not available on Android.' });
    assert.deepEqual(await inspectPaymentMethodReadiness('GOOGLE_PAY', 'ios', bridge),
      { status: 'unavailable', code: 'PAYMENT_METHOD_UNAVAILABLE', reason: 'Google Pay is not available on iOS.' });
    assert.deepEqual(await inspectPaymentMethodReadiness('APPLE_PAY', 'ios', bridge), noCheck);
    assert.deepEqual(await inspectPaymentMethodReadiness('GOOGLE_PAY', 'android', bridge), noCheck);
    for (const method of ['CREDIT_DEBIT_CARD', 'SEPA', 'FUTURE_METHOD']) {
      for (const platform of ['ios', 'android', 'web']) {
        assert.deepEqual(await inspectPaymentMethodReadiness(method, platform, bridge), noCheck);
      }
    }
    for (const [method, name] of [['APPLE_PAY', 'Apple Pay'], ['GOOGLE_PAY', 'Google Pay']]) {
      assert.deepEqual(await inspectPaymentMethodReadiness(method, 'web', bridge),
        { status: 'unavailable', code: 'PAYMENT_METHOD_UNAVAILABLE', reason: `${name} is not available on the web.` });
      assert.equal((await inspectPaymentMethodReadiness(method, 'windows', bridge)).reason,
        `${name} is not available on windows.`);
    }
  }
});
