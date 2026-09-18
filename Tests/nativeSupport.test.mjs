import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canMountOrder, inspectCapabilities } from '../src/nativeSupport.ts';

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
