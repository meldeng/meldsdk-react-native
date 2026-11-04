import { NativeModules, Platform } from 'react-native';
import { describe as describeResult, ensureReady } from '../src/requirements';

test('a requirements result reads as its status, what is left and why it failed', () => {
  expect(
    describeResult({ status: 'READY', providers: [], continuation: [] }),
  ).toBe('Requirements: READY');
  expect(
    describeResult({
      status: 'ACTION_REQUIRED',
      providers: [],
      continuation: [],
      pending: [
        {
          stepId: '*:CUSTOMER_DETAILS:CUSTOMER_EMAIL',
          kind: 'COLLECT',
          type: 'CUSTOMER_DETAILS',
          code: 'CUSTOMER_EMAIL',
          serviceProviders: ['UPHOLD'],
        },
      ],
    }),
  ).toBe('Requirements: ACTION_REQUIRED — CUSTOMER_DETAILS CUSTOMER_EMAIL');
  expect(
    describeResult({
      status: 'ACTION_REQUIRED',
      providers: [
        {
          serviceProvider: 'UPHOLD',
          status: 'ACTION_REQUIRED',
          eligible: false,
          open: [
            {
              type: 'PROVIDER_EXTRA_FIELDS',
              code: 'SOURCE_OF_FUNDS',
              status: 'REQUIRED',
            },
          ],
        },
      ],
      continuation: [],
      pending: [],
    }),
  ).toBe(
    'Requirements: ACTION_REQUIRED — PROVIDER_EXTRA_FIELDS SOURCE_OF_FUNDS',
  );
  expect(
    describeResult({
      status: 'FAILED',
      providers: [],
      continuation: [],
      error: { kind: 'http', status: 403 },
    }),
  ).toBe('Requirements: FAILED (http 403)');
});

test('a binary without the native run reports FAILED instead of hanging the buy flow', async () => {
  expect(Platform.OS).toBe('ios');
  expect(NativeModules.MeldModule.ensureReady).toBeUndefined();
  expect(await ensureReady({ id: 'synthetic' })).toEqual({
    status: 'FAILED',
    providers: [],
    continuation: [],
    error: { kind: 'protocol' },
  });
});
