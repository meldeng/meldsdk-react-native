import test from 'node:test';
import assert from 'node:assert/strict';
import { applyOrderAuthorization, canRenewOrderAuthorization, MeldOrderAuthorizationError } from '../src/orderAuthorization.ts';

const ID = '1111111111111111';
const AUTH = '30000000-0000-0000-0000-000000000003';
const PROTOCOL = 'MELD_ORDER_AUTHORIZATION_V1';
function fixture(provider = 'SYNTHETIC', field = 'continuationToken') {
  const path = `/crypto/order/headless/onramp/${provider}/${ID}/`;
  const order = { id: ID, customerId: 'synthetic-customer', paymentMethodType: 'APPLE_PAY',
    payload: { serviceProvider: provider, sourceAmount: '25.00', destinationWalletAddress: 'synthetic-wallet' },
    paymentMethodResponseDetails: { [field]: 'synthetic-original-bearer', providerIntentId: 'synthetic-intent',
      expiresAtEpochSeconds: 123456789, clientConfiguration: { opaque: true } },
    paymentActions: { version: 1, endpoint: path + 'actions', bearerTokenPointer: `/paymentMethodResponseDetails/${field}`,
      operations: [{ operation: 'READ_SUBMISSION', idempotencyKeyRequired: false }],
      authorizationRenewal: { version: 1, protocol: PROTOCOL, endpoint: path + 'authorization', authentication: 'INTEGRATOR_ACCOUNT' } },
  };
  const response = { version: 1, protocol: PROTOCOL, orderId: ID, serviceProvider: provider,
    state: 'AUTHORIZED', authorizationId: AUTH, expiresAt: '2100-01-01T00:00:00Z', bearer: 'synthetic-renewed-bearer' };
  return { order, response };
}

for (const provider of ['STRIPE', 'MERCURYO', 'SYNTHETIC']) {
  for (const field of ['continuationToken', 'sessionToken']) {
    test(`${provider}/${field}: replaces only the declared credential without mutating the caller`, () => {
      const { order, response } = fixture(provider, field), original = structuredClone(order);
      Object.freeze(order.paymentMethodResponseDetails); Object.freeze(order);
      assert.equal(canRenewOrderAuthorization(order, 'sandbox'), true);
      const copy = applyOrderAuthorization(order, response, 'sandbox');
      assert.notEqual(copy, order); assert.notEqual(copy.paymentMethodResponseDetails, order.paymentMethodResponseDetails);
      assert.equal(copy.paymentMethodResponseDetails[field], response.bearer);
      assert.deepEqual(order, original);
      copy.paymentMethodResponseDetails[field] = original.paymentMethodResponseDetails[field];
      assert.deepEqual(copy, original);
    });
  }
}

test('same-environment absolute discovery is accepted without permitting cross-environment URLs', () => {
  for (const [environment, host] of [['sandbox', 'https://api-sb.meld.io'], ['qa', 'https://api-qa.meld.io'], ['production', 'https://api.meld.io']]) {
    const { order, response } = fixture();
    order.paymentActions.endpoint = host + order.paymentActions.endpoint;
    order.paymentActions.authorizationRenewal.endpoint = host + order.paymentActions.authorizationRenewal.endpoint;
    assert.equal(canRenewOrderAuthorization(order, environment), true);
    assert.equal(applyOrderAuthorization(order, response, environment).id, ID);
    assert.equal(canRenewOrderAuthorization(order, environment === 'qa' ? 'sandbox' : 'qa'), false);
  }
});

test('scope, endpoint, authentication and credential-pointer tampering fail closed', () => {
  const changes = [
    order => { delete order.paymentActions.authorizationRenewal; },
    order => { order.payload.serviceProvider = 'FOREIGN'; },
    order => { order.serviceProvider = 'FOREIGN'; },
    order => { order.paymentActions.authorizationRenewal.authentication = 'ORDER_BEARER'; },
    order => { order.paymentActions.authorizationRenewal.version = 2; },
    ...['/payload/sourceAmount', '/id', '/paymentMethodResponseDetails/__proto__', '/paymentMethodResponseDetails/0', '/paymentMethodResponseDetails/providerIntentId']
      .map(pointer => order => { order.paymentActions.bearerTokenPointer = pointer; }),
    ...['https://foreign.example/actions', '//api-sb.meld.io/actions', 'https://api-sb.meld.io:443/actions']
      .map(endpoint => order => { order.paymentActions.endpoint = endpoint; }),
    ...['?query=1', '#fragment', '\n', '/extra'].map(suffix => order => { order.paymentActions.authorizationRenewal.endpoint += suffix; }),
  ];
  for (const change of changes) {
    const { order, response } = fixture(); change(order);
    assert.equal(canRenewOrderAuthorization(order, 'sandbox'), false);
    assert.throws(() => applyOrderAuthorization(order, response, 'sandbox'), MeldOrderAuthorizationError);
  }
  assert.equal(canRenewOrderAuthorization(null, 'sandbox'), false);
  assert.equal(canRenewOrderAuthorization(fixture().order, '__proto__'), false);
});

test('only a currently usable AUTHORIZED same-order response can replace credentials', () => {
  for (const changes of [
    { version: 2 }, { protocol: 'unknown' }, { orderId: 'foreign' }, { serviceProvider: 'FOREIGN' },
    ...['RENEWABLE', 'SUPERSEDED', 'EXPIRED', 'TERMINAL', 'UNSUPPORTED', 'BUSY'].map(state => ({ state })),
    { authorizationId: '1-1-1-1-1' }, { authorizationId: AUTH + '\n' },
    ...['', 'private\n', 'private\r\n', 'private\t', 'é', 'a'.repeat(16385)].map(bearer => ({ bearer })),
    ...['2000-01-01T00:00:00Z', '2100-02-30T00:00:00Z', '2100-01-01T00:00:00Z\n', '2100-01-01', 'not-a-date'].map(expiresAt => ({ expiresAt })),
  ]) {
    const { order, response } = fixture(); Object.assign(response, changes);
    const original = structuredClone(order);
    assert.throws(() => applyOrderAuthorization(order, response, 'sandbox'), error => {
      assert.equal(error.code, 'INVALID_ORDER_AUTHORIZATION');
      assert.equal(error.message, 'Order authorization could not be applied.');
      assert.equal(error.cause, undefined); assert.equal(error.response, undefined);
      return true;
    });
    assert.deepEqual(order, original);
  }
});

test('response diagnostics and replacement bootstrap fields cannot overwrite the original order', () => {
  const { order, response } = fixture();
  Object.assign(response, { payload: { sourceAmount: '999' }, paymentMethodResponseDetails: { providerIntentId: 'foreign' }, diagnostic: 'private' });
  const copy = applyOrderAuthorization(order, response, 'sandbox');
  assert.equal(copy.payload.sourceAmount, '25.00');
  assert.equal(copy.paymentMethodResponseDetails.providerIntentId, 'synthetic-intent');
  assert.equal(copy.diagnostic, undefined);
});
