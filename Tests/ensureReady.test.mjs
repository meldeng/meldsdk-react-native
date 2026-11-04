import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import {
  openHostedVerificationOn, readyResult, REQUEST_TIMEOUT_MS, runEnsureReady,
} from '../src/ensureReady.ts';

const fixtures = new URL('./fixtures/requirements-fixtures/requirements-session/', import.meta.url);
const sessionFixtures = readdirSync(fixtures).filter((name) => name.endsWith('.json')).sort()
  .map((name) => [name, JSON.parse(readFileSync(new URL(name, fixtures), 'utf8'))]);
const session = sessionFixtures[0][1].mint.response;
const steps = sessionFixtures.flatMap(([name, fixture]) => fixture.exchanges
  .filter((exchange) => exchange.operation === 'READ' && exchange.status === 200)
  .flatMap((exchange) => exchange.response.next.map((step) => [name, step])));

function fakeNative() {
  const calls = [];
  let listener;
  let removed = 0;
  const bridge = {
    ensureReady: (...args) => calls.push(['ensureReady', ...args]),
    respond: (...args) => calls.push(['respond', ...args]),
    refresh: (...args) => calls.push(['refresh', ...args]),
    cancel: (...args) => calls.push(['cancel', ...args]),
  };
  const events = (next) => {
    listener = next;
    return { remove: () => { removed += 1; } };
  };
  const native = {
    bridge, events, calls,
    get removed() { return removed; },
    get handleId() { return calls.find(([name]) => name === 'ensureReady')[1]; },
    emit: (type, payload, requestId) => listener({ handleId: native.handleId, type, payload, ...(requestId ? { requestId } : {}) }),
    send: (event) => listener(event),
    replies: () => calls.filter(([name]) => name === 'respond').map(([, handleId, requestId, json]) => [handleId, requestId, JSON.parse(json)]),
  };
  return native;
}

const flush = () => new Promise((resolve) => setImmediate(resolve));
const pendingResult = (handle) => Promise.race([handle.result, flush().then(() => 'pending')]);

function nativeCollect(step, fieldErrors) {
  return {
    stepId: step.stepId, type: step.type, code: step.code, serviceProviders: step.serviceProviders, fields: step.fields,
    ...(step.reason ? { reason: step.reason } : {}), ...(fieldErrors ? { fieldErrors } : {}),
  };
}

test('the session and the supplied handlers reach the native run, and each request is answered through respond', async () => {
  const native = fakeNative();
  const [, collectStep] = steps.find(([, step]) => step.kind === 'COLLECT');
  const asked = [];
  const handle = runEnsureReady(native.bridge, native.events, session, {
    collect: async (request) => { asked.push(request); return { 'name.firstName': 'Synthetic', 'name.lastName': 'Customer' }; },
    confirmAgreement: () => true,
  }, { waitTimeoutMs: 30000 });

  assert.deepEqual(native.calls[0], ['ensureReady', native.handleId, JSON.stringify(session),
    JSON.stringify({ waitTimeoutMs: 30000, handlers: ['collect', 'confirmAgreement'] })]);
  native.emit('collect', nativeCollect(collectStep), 'request-1');
  await flush();
  assert.deepEqual(asked, [nativeCollect(collectStep)]);
  assert.deepEqual(native.replies(),
    [[native.handleId, 'request-1', { values: { 'name.firstName': 'Synthetic', 'name.lastName': 'Customer' } }]]);

  native.emit('confirmAgreement', { stepId: 'UPHOLD:AGREEMENT:TERMS', serviceProvider: 'UPHOLD', code: 'TERMS' }, 'request-2');
  await flush();
  assert.deepEqual(native.replies()[1], [native.handleId, 'request-2', { accepted: true }]);

  native.emit('result', { status: 'READY', providers: [{ serviceProvider: 'UPHOLD', status: 'READY', eligible: true, open: [] }], continuation: [] });
  assert.deepEqual(await handle.result,
    { status: 'READY', providers: [{ serviceProvider: 'UPHOLD', status: 'READY', eligible: true, open: [] }], continuation: [] });
  assert.equal(native.removed, 1);
});

test('without options only the handler names are sent', () => {
  const native = fakeNative();
  runEnsureReady(native.bridge, native.events, session, { onProgress() {}, presentUrl: async () => {}, renewSession: () => null });
  assert.equal(native.calls[0][3], JSON.stringify({ handlers: ['onProgress', 'presentUrl', 'renewSession'] }));
  const bare = fakeNative();
  runEnsureReady(bare.bridge, bare.events, session);
  assert.equal(bare.calls[0][3], JSON.stringify({ handlers: [] }));
});

test('each request type has its own reply, and a handler that throws or answers badly declines', async () => {
  const native = fakeNative();
  const presented = [];
  const renewed = { id: 'Renewed1', token: 'synthetic' };
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args[0]);
  try {
    runEnsureReady(native.bridge, native.events, session, {
      collect: (request) => (request.stepId === 'throws' ? Promise.reject(new Error('form closed')) : { email: 42 }),
      confirmAgreement: () => 'yes',
      presentUrl: (request) => { presented.push(request); },
      renewSession: async () => renewed,
    });
    native.emit('collect', { stepId: 'throws', type: 'CUSTOMER_DETAILS', code: 'CUSTOMER_EMAIL', serviceProviders: [], fields: [] }, 'a');
    native.emit('collect', { stepId: 'bad', type: 'CUSTOMER_DETAILS', code: 'CUSTOMER_EMAIL', serviceProviders: [], fields: [] }, 'b');
    native.emit('confirmAgreement', { stepId: 's', serviceProvider: 'P', code: 'C', url: 'https://example.test/terms' }, 'c');
    native.emit('presentUrl', { stepId: 's', url: 'https://example.test/page', expiresAt: '2026-11-04T15:28:30Z' }, 'd');
    native.emit('renewSession', {}, 'e');
    await flush();
  } finally {
    console.error = original;
  }
  assert.deepEqual(native.replies().sort((x, y) => x[1].localeCompare(y[1])).map(([, id, reply]) => [id, reply]), [
    ['a', { values: null }], ['b', { values: null }], ['c', { accepted: false }], ['d', {}], ['e', { session: renewed }],
  ]);
  assert.deepEqual(presented, [{ stepId: 's', url: 'https://example.test/page', expiresAt: '2026-11-04T15:28:30Z' }]);
  assert.deepEqual(errors.sort(), ['[meld-sdk] collect must answer string values or null', '[meld-sdk] handler collect threw']);
});

test('null from collect and from renewSession is passed on as null', async () => {
  const native = fakeNative();
  runEnsureReady(native.bridge, native.events, session, { collect: () => null, renewSession: () => undefined });
  native.emit('collect', { stepId: 's', type: 'T', code: 'C', serviceProviders: [], fields: [] }, 'a');
  native.emit('renewSession', {}, 'b');
  await flush();
  assert.deepEqual(native.replies().map(([, id, reply]) => [id, reply]), [['a', { values: null }], ['b', { session: null }]]);
});

test('an unanswered collect ends the run CANCELLED after 10 minutes and cancels the native run', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const native = fakeNative();
  let answer;
  const handle = runEnsureReady(native.bridge, native.events, session, {
    collect: () => new Promise((resolve) => { answer = resolve; }),
  });
  native.emit('collect', { stepId: 's', type: 'T', code: 'C', serviceProviders: [], fields: [] }, 'late');
  await flush();
  t.mock.timers.tick(REQUEST_TIMEOUT_MS - 1);
  assert.equal(await pendingResult(handle), 'pending');
  assert.deepEqual(native.calls.map(([name]) => name), ['ensureReady']);

  t.mock.timers.tick(1);
  assert.deepEqual(await handle.result, { status: 'CANCELLED', providers: [], continuation: [] });
  assert.deepEqual(native.calls.at(-1), ['cancel', native.handleId]);
  answer({ email: 'late@example.test' });
  native.emit('result', { status: 'READY', providers: [], continuation: [] });
  await flush();
  assert.deepEqual(native.replies(), []);
  assert.equal((await handle.result).status, 'CANCELLED');
});

test('an unanswered confirmAgreement or renewSession also ends the run CANCELLED after 10 minutes', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const [type, payload] of [['confirmAgreement', { stepId: 's', serviceProvider: 'P', code: 'C' }], ['renewSession', {}]]) {
    const native = fakeNative();
    const handle = runEnsureReady(native.bridge, native.events, session, { [type]: () => new Promise(() => {}) });
    native.emit(type, payload, 'r');
    await flush();
    t.mock.timers.tick(REQUEST_TIMEOUT_MS);
    assert.deepEqual(await pendingResult(handle), { status: 'CANCELLED', providers: [], continuation: [] }, type);
    assert.deepEqual(native.calls.at(-1), ['cancel', native.handleId], type);
  }
});

test('a page open through presentUrl has no time limit, and cancel() still ends the run', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const native = fakeNative();
  let close;
  const handle = runEnsureReady(native.bridge, native.events, session, {
    presentUrl: () => new Promise((resolve) => { close = resolve; }),
  });
  native.emit('presentUrl', { stepId: 's', url: 'https://example.test/page' }, 'page');
  await flush();
  t.mock.timers.tick(REQUEST_TIMEOUT_MS * 3);
  assert.equal(await pendingResult(handle), 'pending');
  assert.ok(!native.calls.some(([name]) => name === 'cancel'));
  close();
  await flush();
  assert.deepEqual(native.replies(), [[native.handleId, 'page', {}]]);

  const open = fakeNative();
  const cancelled = runEnsureReady(open.bridge, open.events, session, {
    presentUrl: () => new Promise((resolve) => { close = resolve; }),
  });
  open.emit('presentUrl', { stepId: 's', url: 'https://example.test/page' }, 'page');
  await flush();
  t.mock.timers.tick(REQUEST_TIMEOUT_MS * 3);
  cancelled.cancel();
  assert.deepEqual(await cancelled.result, { status: 'CANCELLED', providers: [], continuation: [] });
  assert.deepEqual(open.calls.at(-1), ['cancel', open.handleId]);
  close();
  await flush();
  assert.deepEqual(open.replies(), []);
});

test('an answered request stops its timer, so the run is not cancelled later', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const native = fakeNative();
  const handle = runEnsureReady(native.bridge, native.events, session, { confirmAgreement: async () => true });
  native.emit('confirmAgreement', { stepId: 's', serviceProvider: 'P', code: 'C' }, 'r');
  await flush();
  t.mock.timers.tick(REQUEST_TIMEOUT_MS * 2);
  assert.equal(await pendingResult(handle), 'pending');
  assert.ok(!native.calls.some(([name]) => name === 'cancel'));
});

test('cancel resolves CANCELLED at once, cancels the native run once, and ends refresh', async () => {
  const native = fakeNative();
  const handle = runEnsureReady(native.bridge, native.events, session, {});
  handle.refresh();
  handle.cancel();
  handle.cancel();
  handle.refresh();
  assert.deepEqual(await handle.result, { status: 'CANCELLED', providers: [], continuation: [] });
  assert.deepEqual(native.calls.slice(1), [['refresh', native.handleId], ['cancel', native.handleId]]);
  assert.equal(native.removed, 1);
});

test('a run cancelled from onProgress calls no handler and answers no request after it', async () => {
  const native = fakeNative();
  const called = [];
  const handle = runEnsureReady(native.bridge, native.events, session, {
    onProgress: (progress) => { called.push(progress.state); handle.cancel(); },
    collect: () => { called.push('collect'); return {}; },
    confirmAgreement: () => { called.push('confirmAgreement'); return true; },
    presentUrl: () => { called.push('presentUrl'); },
    renewSession: () => { called.push('renewSession'); return null; },
  });
  native.emit('progress', { state: 'AWAITING_INPUT' });
  native.emit('collect', { stepId: 's', type: 'T', code: 'C', serviceProviders: [], fields: [] }, 'r1');
  native.emit('confirmAgreement', { stepId: 's', serviceProvider: 'P', code: 'C' }, 'r2');
  native.emit('presentUrl', { stepId: 's', url: 'https://example.test/page' }, 'r3');
  native.emit('renewSession', {}, 'r4');
  native.emit('progress', { state: 'RUNNING' });
  await flush();
  assert.deepEqual(called, ['AWAITING_INPUT']);
  assert.deepEqual(native.replies(), []);
  assert.deepEqual(await handle.result, { status: 'CANCELLED', providers: [], continuation: [] });
  assert.deepEqual(native.calls.slice(1), [['cancel', native.handleId]]);
});

test('once the result is in, a kept handle holds none of the handlers', async () => {
  setFlagsFromString('--expose-gc');
  const gc = runInNewContext('gc');
  for (const end of ['result', 'cancel']) {
    const native = fakeNative();
    const [handle, handlers] = (() => {
      const supplied = { onProgress() {}, collect: () => null, confirmAgreement: () => true, presentUrl() {}, renewSession: () => null };
      return [runEnsureReady(native.bridge, native.events, session, supplied), new WeakRef(supplied)];
    })();
    if (end === 'result') native.emit('result', { status: 'READY', providers: [], continuation: [] });
    else handle.cancel();
    await handle.result;
    await flush();
    gc();
    assert.equal(handlers.deref(), undefined, end);
    handle.refresh();
  }
});

test('progress reaches onProgress with the snapshot; a throwing onProgress does not end the run', async () => {
  const native = fakeNative();
  const seen = [];
  const original = console.error;
  console.error = () => {};
  try {
    const handle = runEnsureReady(native.bridge, native.events, session, {
      onProgress: (progress) => { seen.push(progress); throw new Error('render failed'); },
    });
    const snapshot = sessionFixtures[0][1].exchanges[0].response;
    native.emit('progress', { state: 'READING' });
    native.emit('progress', { state: 'WAITING', snapshot });
    assert.deepEqual(seen, [{ state: 'READING', snapshot: null }, { state: 'WAITING', snapshot }]);
    assert.equal(await pendingResult(handle), 'pending');
  } finally {
    console.error = original;
  }
});

test('events for another run, without a requestId, or of an unknown type are ignored', async () => {
  const native = fakeNative();
  const asked = [];
  const handle = runEnsureReady(native.bridge, native.events, session, { collect: (r) => { asked.push(r); return null; } });
  native.send({ handleId: 'ready-other', requestId: 'x', type: 'collect', payload: { stepId: 's' } });
  native.send({ handleId: 'ready-other', type: 'result', payload: { status: 'READY' } });
  for (const event of [null, 'result', { type: 'result' }]) native.send(event);
  native.emit('collect', { stepId: 's' });
  native.emit('collect', { stepId: 's' }, '');
  native.emit('somethingNew', {}, 'x');
  await flush();
  assert.deepEqual(asked, []);
  assert.deepEqual(native.replies(), []);
  assert.equal(await pendingResult(handle), 'pending');
});

test('two runs get different handle ids and only hear their own events', async () => {
  const first = fakeNative();
  const second = fakeNative();
  const a = runEnsureReady(first.bridge, first.events, session, {});
  runEnsureReady(second.bridge, second.events, session, {});
  assert.notEqual(first.handleId, second.handleId);
  first.emit('result', { status: 'BLOCKED', providers: [], continuation: [] });
  assert.equal((await a.result).status, 'BLOCKED');
});

test('a binary without the native run resolves FAILED protocol and sends nothing', async () => {
  let started = 0;
  for (const bridge of [undefined, null, {}, { ensureReady() { started += 1; } }]) {
    let subscribed = 0;
    const handle = runEnsureReady(bridge, () => { subscribed += 1; return { remove() {} }; }, session, {});
    assert.deepEqual(await handle.result, { status: 'FAILED', providers: [], continuation: [], error: { kind: 'protocol' } });
    assert.equal(subscribed, 0);
  }
  assert.equal(started, 0);
  const native = fakeNative();
  const handle = runEnsureReady(native.bridge, undefined, session, {});
  assert.equal((await handle.result).status, 'FAILED');
  assert.deepEqual(native.calls, []);
  const throwing = fakeNative();
  throwing.bridge.ensureReady = () => { throw new Error('bridge torn down'); };
  assert.deepEqual((await runEnsureReady(throwing.bridge, throwing.events, session).result).error, { kind: 'protocol' });
  assert.equal(throwing.removed, 1);
});

test('a session that is not a JSON object, a handler that is not a function or a bad timeout throws', () => {
  const native = fakeNative();
  const cyclic = {};
  cyclic.self = cyclic;
  for (const bad of [undefined, null, 'session', 1, [], cyclic, { big: 1n }]) {
    assert.throws(() => runEnsureReady(native.bridge, native.events, bad), TypeError);
  }
  assert.throws(() => runEnsureReady(native.bridge, native.events, session, { collect: 'form' }), TypeError);
  for (const waitTimeoutMs of [-1, Number.NaN, Infinity, '1000']) {
    assert.throws(() => runEnsureReady(native.bridge, native.events, session, {}, { waitTimeoutMs }), TypeError);
  }
  assert.deepEqual(native.calls, []);
});

test('ACTION_REQUIRED carries every pending step of every fixture READ unchanged', () => {
  assert.ok(steps.length >= 8);
  for (const [name, step] of steps) {
    const mapped = readyResult({ status: 'ACTION_REQUIRED', providers: [], pending: [step], continuation: [] });
    assert.deepEqual(mapped.pending, [step], `${name} ${step.stepId}`);
  }
});

test('a COLLECT step from every fixture reaches collect with its fields and field errors', async () => {
  for (const [name, step] of steps.filter(([, s]) => s.kind === 'COLLECT')) {
    const native = fakeNative();
    const asked = [];
    runEnsureReady(native.bridge, native.events, session, { collect: (r) => { asked.push(r); return null; } });
    const fieldErrors = step.fields.map((f) => ({ key: f.key, reason: 'INVALID' }));
    native.emit('collect', nativeCollect(step, fieldErrors), 'r');
    await flush();
    assert.deepEqual(asked, [nativeCollect(step, fieldErrors)], name);
  }
});

test('result mapping keeps the documented members and fails closed on a malformed answer', () => {
  const providers = [
    { serviceProvider: 'BANXA', status: 'ACTION_REQUIRED', eligible: false,
      open: [{ type: 'MELD_KYC', code: 'MELD_KYC', status: 'REQUIRED', reason: 'NOT_STARTED' }] },
    { serviceProvider: 'UPHOLD', status: 'UNDETERMINED', eligible: null, open: [] },
    { serviceProvider: 'COINME', status: 'BLOCKED', eligible: false,
      open: [{ type: 'PROVIDER_KYC_SHARE', code: 'PROVIDER_KYC_SHARE', status: 'BLOCKED', reason: 'R', errorCodes: ['A', 'B'] }] },
  ];
  const continuation = [{ serviceProvider: 'STRIPE', code: 'IDENTITY', nextStep: 'SDK_STEP' }, { serviceProvider: 'X', code: 'Y' }];
  assert.deepEqual(readyResult({ status: 'READY', providers, continuation, pending: [steps[0][1]], error: { kind: 'http' } }),
    { status: 'READY', providers, continuation });
  assert.deepEqual(readyResult({ status: 'FAILED', providers: [], continuation: [], error: { kind: 'http', status: 403, code: 'X' } }),
    { status: 'FAILED', providers: [], continuation: [], error: { kind: 'http', status: 403, code: 'X' } });
  assert.deepEqual(readyResult({ status: 'FAILED', error: { kind: 'transport', status: 1.5 } }),
    { status: 'FAILED', providers: [], continuation: [], error: { kind: 'transport' } });
  assert.deepEqual(readyResult({ status: 'FAILED', error: { kind: 'other' } }).error, { kind: 'protocol' });
  assert.deepEqual(readyResult({ status: 'FAILED' }).error, { kind: 'protocol' });
  assert.deepEqual(readyResult({ status: 'ACTION_REQUIRED' }), { status: 'ACTION_REQUIRED', providers: [], continuation: [], pending: [] });
  for (const status of [undefined, 'ready', 'DONE', 3]) {
    assert.deepEqual(readyResult({ status }), { status: 'FAILED', providers: [], continuation: [], error: { kind: 'protocol' } });
  }
  assert.deepEqual(readyResult({
    status: 'BLOCKED',
    providers: [null, { serviceProvider: 'P' }, { serviceProvider: 'P', status: 'BLOCKED', eligible: 'no', open: [{ type: 'T' }] }],
    continuation: [{ code: 'C' }, 'x'],
  }), { status: 'BLOCKED', providers: [{ serviceProvider: 'P', status: 'BLOCKED', eligible: null, open: [] }], continuation: [] });
});

test('every open requirement of every fixture READ reaches the result with its reason and errorCodes', () => {
  const open = (requirement) => requirement.timing === 'PRE_ORDER' && requirement.status !== 'SATISFIED';
  const pick = ({ type, code, status, reason, errorCodes }) =>
    ({ type, code, status, ...(reason ? { reason } : {}), ...(errorCodes ? { errorCodes } : {}) });
  let withCodes = 0;
  for (const [name, fixture] of sessionFixtures) {
    for (const exchange of fixture.exchanges.filter((e) => e.operation === 'READ' && e.status === 200)) {
      const providers = exchange.response.providers.map((p) => ({
        serviceProvider: p.serviceProvider, status: p.status, eligible: p.eligible ?? null,
        open: p.requirements.filter(open).map(pick),
      }));
      withCodes += providers.flatMap((p) => p.open).filter((r) => r.errorCodes).length;
      assert.deepEqual(readyResult({ status: 'BLOCKED', providers, continuation: [] }).providers, providers, name);
    }
  }
  assert.ok(withCodes >= 1, 'a fixture has a share refused with errorCodes');
  const refused = sessionFixtures.find(([name]) => name === 'coinme-share-refused.json')[1].exchanges.at(-1).response;
  assert.deepEqual(refused.providers[0].requirements.filter(open).map(pick)[0], {
    type: 'PROVIDER_KYC_SHARE', code: 'PROVIDER_KYC_SHARE', status: 'BLOCKED',
    reason: "Coinme needs the customer's phone verified first", errorCodes: ['PHONE_VERIFICATION_REQUIRED'],
  });
});

test('errorCodes are kept only as a non-empty list of strings, and the requirement is kept either way', () => {
  const share = { type: 'PROVIDER_KYC_SHARE', code: 'PROVIDER_KYC_SHARE', status: 'BLOCKED', reason: 'R' };
  const mapped = (errorCodes) => readyResult({
    status: 'BLOCKED', continuation: [],
    providers: [{ serviceProvider: 'COINME', status: 'BLOCKED', eligible: false, open: [{ ...share, errorCodes }] }],
  }).providers[0].open;
  assert.deepEqual(mapped(['PHONE_VERIFICATION_REQUIRED']), [{ ...share, errorCodes: ['PHONE_VERIFICATION_REQUIRED'] }]);
  for (const errorCodes of [undefined, null, [], 'PHONE_VERIFICATION_REQUIRED', { code: 'X' }, ['X', 1], [null]]) {
    assert.deepEqual(mapped(errorCodes), [share], JSON.stringify(errorCodes));
  }
});

test('openHostedVerification opens https pages through the native presenter and resolves on close', async () => {
  const opened = [];
  const bridge = { openHostedVerification: async (url) => { opened.push(url); } };
  await openHostedVerificationOn(bridge, 'https://verify.example.test/session?x=1');
  assert.deepEqual(opened, ['https://verify.example.test/session?x=1']);
  for (const url of ['http://verify.example.test', 'HTTPS://verify.example.test', 'https://', 'https://user@host', 'javascript:x', 1, null]) {
    await assert.rejects(openHostedVerificationOn(bridge, url), TypeError, String(url));
  }
  assert.equal(opened.length, 1);
  await assert.rejects(openHostedVerificationOn({}, 'https://verify.example.test'), /Update the native app/);
  await assert.rejects(openHostedVerificationOn({ openHostedVerification: () => Promise.reject(new Error('no activity')) },
    'https://verify.example.test'), /no activity/);
});
