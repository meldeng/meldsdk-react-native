import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MeldErrorCode, attemptMayExist } from '../src/errorCodes.ts';

test('each constant is its own code', () => {
  for (const [name, code] of Object.entries(MeldErrorCode)) assert.equal(code, name);
});

test('MeldErrorCode names the seven shared codes and the wrapper\'s four, and no others', () => {
  assert.deepEqual(Object.keys(MeldErrorCode), ['PAYMENT_METHOD_UNAVAILABLE', 'PRESENTATION_FAILED', 'PAYMENT_REJECTED',
    'ORDER_STATE_CHANGED', 'VERIFICATION_PENDING', 'PAYMENT_OUTCOME_UNKNOWN', 'PROVIDER_LOAD_FAILED',
    'INVALID_ORDER', 'INVALID_APPLE_PAY_REQUEST', 'MOUNT_FAILED', 'UNSUPPORTED_NATIVE_PROTOCOL']);
});

test('the shared codes rule out an attempt exactly as MeldSDK iOS 0.10 and io.meld:meldsdk 0.8.0 do', () => {
  for (const [code, mayExist] of [['PAYMENT_METHOD_UNAVAILABLE', false], ['PRESENTATION_FAILED', false],
    ['PAYMENT_REJECTED', false], ['ORDER_STATE_CHANGED', false], ['VERIFICATION_PENDING', false],
    ['PAYMENT_OUTCOME_UNKNOWN', true], ['PROVIDER_LOAD_FAILED', true]]) {
    assert.equal(attemptMayExist(code), mayExist, code);
  }
});

test('every platform or provider code may follow an attempt', () => {
  for (const code of ['PAYMENT_STATE_UNAVAILABLE', 'PAYMENT_CONTINUATION_UNAVAILABLE', 'INVALID_VERIFICATION',
    'VERIFICATION_WINDOW_EXPIRED', 'VERIFICATION_UNAVAILABLE', 'WAIT_FOR_PAYMENT', 'PAYMENT_NOT_ACCEPTED',
    'authorize_session_failed', 'authorize_session_invalid', 'checkout_init_failed', 'error', 'failed', 'rejected']) {
    assert.equal(attemptMayExist(code), true, code);
  }
});

test('codes from before 0.10.0 read like any code this version does not know', () => {
  for (const code of ['NAVIGATION_FAILED', 'EMPTY_APPLE_PAY_TOKEN', 'MISSING_BILLING_NAME', 'PAYMENT_NOT_SUBMITTED',
    'sdk_unavailable', 'mount_failed']) {
    assert.equal(attemptMayExist(code), true, code);
  }
});

test('the wrapper\'s own codes say nothing was mounted', () => {
  for (const code of ['INVALID_ORDER', 'INVALID_APPLE_PAY_REQUEST', 'MOUNT_FAILED', 'UNSUPPORTED_NATIVE_PROTOCOL']) {
    assert.equal(attemptMayExist(code), false, code);
  }
});

test('APPLE_PAY_UNAVAILABLE is gone and reads like any code this version does not know', () => {
  assert.equal(Object.hasOwn(MeldErrorCode, 'APPLE_PAY_UNAVAILABLE'), false);
  assert.equal(Object.values(MeldErrorCode).includes('APPLE_PAY_UNAVAILABLE'), false);
  assert.equal(attemptMayExist('APPLE_PAY_UNAVAILABLE'), true);
});

test('an unknown, misspelled or non-string code may follow an attempt', () => {
  for (const code of ['', 'FUTURE_CODE', 'payment_method_unavailable', ' PRESENTATION_FAILED', 'PAYMENT_REJECTED\n',
    undefined, null, 0, {}]) {
    assert.equal(attemptMayExist(code), true, String(code));
  }
});
