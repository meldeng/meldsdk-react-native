import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canMountOrder, inspectCapabilities, inspectPresentationCapabilities } from '../src/nativeSupport.ts';

const declared = { id: 'synthetic', headlessPresentation: { surface: 'NATIVE_SDK', protocol: 'SYNTHETIC', version: 1 }, paymentActions: { version: 1 } };
const caps = { embeddable: false, surface: 'native-sdk', requiresUserGesture: true };

test('an OTA bundle cannot dispatch declared orders through an old native resolver', async () => {
  for (const version of [undefined, null, true, '1', 0, 2]) {
    const bridge = { headlessProtocolVersion: version, capabilities() { assert.fail('Must not reach old native code'); } };
    assert.equal(canMountOrder(declared, bridge), false);
    assert.equal((await inspectCapabilities(declared, bridge)).surface, 'unsupported');
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
