import assert from 'node:assert/strict';
import test from 'node:test';
import {parseHeadlessError} from '../src/headlessError.ts';

const pairs = [
  ['INVALID_REQUEST', 'CORRECT_REQUEST'], ['AUTHENTICATION_REQUIRED', 'AUTHENTICATE'],
  ['ACCESS_DENIED', 'STOP'], ['NOT_FOUND', 'STOP'], ['UNSUPPORTED_PROTOCOL', 'READ_REQUIREMENTS'],
  ['REQUIREMENT_REQUIRED', 'READ_REQUIREMENTS'], ['REQUIREMENT_PENDING', 'READ_STATE'],
  ['REQUIREMENT_BLOCKED', 'STOP'], ['ORDER_REJECTED', 'STOP'], ['REQUEST_CONFLICT', 'READ_STATE'],
  ['OPERATION_IN_FLIGHT', 'READ_STATE'], ['STATE_CHANGED', 'READ_STATE'],
  ['DEPENDENCY_UNAVAILABLE', 'READ_STATE'], ['DEPENDENCY_UNAVAILABLE', 'RETRY_READ'], ['OUTCOME_UNKNOWN', 'READ_STATE'],
];
const advice = {version: 1, category: 'AUTHENTICATION_REQUIRED', recovery: 'AUTHENTICATE', automaticRetryAllowed: false};

test('all supported recovery pairs are projected to exactly four fields', () => {
  for (const [category, recovery] of pairs) {
    const expected = {...advice, category, recovery};
    const raw = {...expected, message: 'synthetic-private', nested: {token: 'synthetic'}};
    assert.deepEqual(parseHeadlessError(raw), expected);
    assert.notEqual(parseHeadlessError(raw), raw);
  }
});

test('missing fields, unknown metadata and coercions never create advice', () => {
  for (const value of [undefined, null, true, 0, '1', [], {}]) assert.equal(parseHeadlessError(value), undefined);
  for (const field of Object.keys(advice)) {
    const missing = {...advice};
    delete missing[field];
    assert.equal(parseHeadlessError(missing), undefined);
  }
  for (const [field, values] of [
    ['version', [true, '1', 1.5, 2]], ['automaticRetryAllowed', [0, true, 'false']],
    ['category', ['FUTURE', 'toString', '__proto__', 'ACCESS_DENIED']],
    ['recovery', ['FUTURE', 'RETRY_READ', 'STOP']],
  ]) for (const value of values) assert.equal(parseHeadlessError({...advice, [field]: value}), undefined);
});
