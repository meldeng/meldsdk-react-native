import { test } from 'node:test';
import assert from 'node:assert/strict';
import { configureNative, isNativeBridgeAvailable, inspectPresentationCapabilities, inspectCapabilities } from '../src/nativeSupport.ts';

test('native availability includes Android without admitting missing or web bridges', () => {
  const bridge = { capabilities() {} };
  for (const platform of ['ios', 'android']) assert.equal(isNativeBridgeAvailable(platform, bridge), true);
  for (const platform of ['web', 'windows', 'macos']) assert.equal(isNativeBridgeAvailable(platform, bridge), false);
  for (const value of [null, undefined, {}, { capabilities: true }]) {
    assert.equal(isNativeBridgeAvailable('android', value), false);
  }
});

test('configuration rejects unsupported environments before invoking native code', () => {
  const calls = [];
  const bridge = { capabilities() {}, configure(value) { calls.push(value); } };
  for (const platform of ['ios', 'android']) for (const environment of ['sandbox', 'production']) {
    configureNative(environment, platform, bridge);
    assert.equal(calls.at(-1), environment);
  }
  configureNative('qa', 'ios', bridge);
  assert.equal(calls.at(-1), 'qa');
  for (const environment of ['qa', 'QA', '', 'staging', 'production\n']) {
    assert.throws(() => configureNative(environment, 'android', bridge), /unsupported/);
  }
  assert.equal(calls.length, 5);
  assert.throws(() => configureNative('production', 'android', null), /unavailable/);
});

test('Android compatible bridge supports card discovery while wallet protocols stay unsupported', async () => {
  const unsupported = { embeddable: false, surface: 'unsupported', requiresUserGesture: false };
  const card = { embeddable: true, surface: 'embedded', requiresUserGesture: false };
  const bridge = { headlessProtocolVersion: 1,
    async presentationCapabilities(method, value) { return method === 'CREDIT_DEBIT_CARD' && value.protocol === 'MERCURYO_WIDGET' ? card : unsupported; },
    async capabilities(order) { assert.equal(order.payload.serviceProvider, 'SYNTHETIC'); return card; },
  };
  const descriptor = { surface: 'EMBEDDED_WIDGET', protocol: 'MERCURYO_WIDGET', version: 1 };
  assert.deepEqual(await inspectPresentationCapabilities('CREDIT_DEBIT_CARD', descriptor, bridge), card);
  assert.deepEqual(await inspectCapabilities({ headlessPresentation: descriptor, payload: { serviceProvider: 'SYNTHETIC' } }, bridge), card);
  assert.deepEqual(await inspectPresentationCapabilities('APPLE_PAY', { ...descriptor, protocol: 'MELD_WALLET_TOKEN', surface: 'SYSTEM_WALLET_TOKEN' }, bridge), unsupported);
  assert.deepEqual(await inspectPresentationCapabilities('CREDIT_DEBIT_CARD', descriptor, { ...bridge, headlessProtocolVersion: undefined }), unsupported);
});
