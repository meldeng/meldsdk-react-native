/**
 * Normalized `MeldError.code` values. Every Meld SDK (MeldSDK iOS 0.10, io.meld:meldsdk 0.8.0) names
 * the first group, with the same `attemptMayExist` answers; this wrapper emits the second when
 * nothing was mounted. The provider's own event and code travel in `detail`. Treat any other code as
 * one that may follow a payment attempt.
 */
export const MeldErrorCode = {
  /** No attempt exists. This device or customer cannot pay with the order's method; offer another. */
  PAYMENT_METHOD_UNAVAILABLE: 'PAYMENT_METHOD_UNAVAILABLE',
  /** No attempt exists. The next attempt needs a new order. */
  PRESENTATION_FAILED: 'PRESENTATION_FAILED',
  /** Declined; nothing will settle. Offer another option. */
  PAYMENT_REJECTED: 'PAYMENT_REJECTED',
  /** No attempt exists. The provider no longer accepts this order. */
  ORDER_STATE_CHANGED: 'ORDER_STATE_CHANGED',
  /** No attempt exists. The provider is reviewing the customer. */
  VERIFICATION_PENDING: 'VERIFICATION_PENDING',
  /** An attempt may exist. Track the order and never pay it again. */
  PAYMENT_OUTCOME_UNKNOWN: 'PAYMENT_OUTCOME_UNKNOWN',
  /** An attempt may exist. The provider's page did not load; `recoverable` says whether a retry may work. */
  PROVIDER_LOAD_FAILED: 'PROVIDER_LOAD_FAILED',

  /** Nothing was mounted: the order JSON could not be parsed. */
  INVALID_ORDER: 'INVALID_ORDER',
  /** Nothing was mounted: the `applePay` prop is malformed (iOS only). */
  INVALID_APPLE_PAY_REQUEST: 'INVALID_APPLE_PAY_REQUEST',
  /** Nothing was mounted: the native SDK refused the order or had nowhere to present it. */
  MOUNT_FAILED: 'MOUNT_FAILED',
  /** Nothing was mounted: this app binary cannot present the order's declared protocol. */
  UNSUPPORTED_NATIVE_PROTOCOL: 'UNSUPPORTED_NATIVE_PROTOCOL',
} as const;

const noAttempt = new Set<unknown>([
  MeldErrorCode.PAYMENT_METHOD_UNAVAILABLE, MeldErrorCode.PRESENTATION_FAILED, MeldErrorCode.PAYMENT_REJECTED,
  MeldErrorCode.ORDER_STATE_CHANGED, MeldErrorCode.VERIFICATION_PENDING,
  MeldErrorCode.INVALID_ORDER, MeldErrorCode.INVALID_APPLE_PAY_REQUEST, MeldErrorCode.MOUNT_FAILED,
  MeldErrorCode.UNSUPPORTED_NATIVE_PROTOCOL,
]);

/**
 * Whether a payment attempt may exist after a non-recoverable `onError` with this code. False only
 * for the codes that say none does; every other code, including one this version does not know,
 * may follow a payment: track the order and never pay it again. Equals `attemptMayExist` in MeldSDK
 * iOS 0.10 and io.meld:meldsdk 0.8.0 for every code except this wrapper's own four, which no native
 * SDK emits and which the native functions answer true for.
 */
export function attemptMayExist(code: string): boolean {
  return !noAttempt.has(code);
}
