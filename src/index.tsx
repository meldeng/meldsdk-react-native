import React from 'react';
import { requireNativeComponent, NativeModules, Platform, type ViewStyle } from 'react-native';
import {
  canMountOrder, inspectCapabilities, inspectPaymentMethodReadiness, inspectPresentationCapabilities,
  inspectPresentationReadiness, isNativeBridgeAvailable, presentationOf, type MeldHeadlessPresentation, type MeldPresentationRow,
  type MeldReadiness,
} from './nativeSupport';
import { MeldErrorCode } from './errorCodes';

export type { MeldHeadlessPresentation, MeldPresentationRow, MeldReadiness } from './nativeSupport';
export { MeldErrorCode, attemptMayExist } from './errorCodes';

export type MeldEnvironment = 'sandbox' | 'qa' | 'production';
export type MeldStatus = 'pending' | 'completed' | 'failed' | 'cancelled';

/**
 * The `HeadlessOrderResponse` from your backend (`POST /crypto/order/headless`). The SDK forwards
 * it to the native layer verbatim. JavaScript only checks bridge compatibility and event identity,
 * so this is an open JSON object (string keys, `unknown` values) rather than a fixed schema.
 * It is narrower than
 * `object`: callers must pass a string-keyed map and narrow values before using them.
 */
export type MeldOrder = Record<string, unknown>;

export interface MeldStatusChange {
  orderId?: string;
  /** Normalized status — code against this, not `providerStatus`. */
  status: MeldStatus;
  /** Raw provider status code, for logging. */
  providerStatus?: string;
  /** Raw provider payload, when JSON-serializable — for logging/debugging only. */
  raw?: unknown;
}

export interface MeldError {
  orderId?: string;
  /** A `MeldErrorCode` value, or a provider-specific one. `attemptMayExist(code)` reads it. */
  code: string;
  message: string;
  /** Extra diagnostic detail when the SDK has it (e.g. an NSError domain/code). May be empty. */
  detail?: string;
  /**
   * True only when a visible embedded card widget hit a problem the customer can fix in place; not
   * terminal. False is terminal: `code` says whether a payment attempt may exist.
   */
  recoverable: boolean;
  /**
   * The order's `paymentMethodType`, such as `APPLE_PAY`, so copy such as "Apple Pay isn't
   * available" can name the method without branching on `code`. Absent when the order has none.
   */
  paymentMethodType?: string;
}

export interface MeldCapabilities {
  /** True: the payment renders into the component, so give it room. False: it needs no visible area. */
  embeddable: boolean;
  /**
   * `'unsupported'`: this app build cannot present it here. Every other value is informational and
   * may change without notice, so branch only on `'unsupported'` and `embeddable`.
   */
  surface: string;
  /** True: mount from the customer's tap. */
  requiresUserGesture: boolean;
}

/**
 * Advisory support for a quote row's (or payment method's) declared presentation before creating
 * an order. The installed native adapter registry owns support, including on OTA-updated apps.
 * Missing bridge support returns `unsupported`. Still check eligibility, device readiness
 * (`presentationReadiness`) and legal requirements, then call `capabilities(order)` with the
 * actual order before mounting it.
 */
function presentationCapabilities(row: MeldPresentationRow): Promise<MeldCapabilities>;
/** The positional form of `presentationCapabilities(row)`. */
function presentationCapabilities(paymentMethodType: string, presentation: MeldHeadlessPresentation): Promise<MeldCapabilities>;
function presentationCapabilities(
  rowOrType: MeldPresentationRow | string, presentation?: MeldHeadlessPresentation,
): Promise<MeldCapabilities> {
  const [paymentMethodType, declared] = presentationOf(rowOrType, presentation);
  return inspectPresentationCapabilities(paymentMethodType, declared, NativeModules.MeldModule);
}

export const Meld = {
  /**
   * True when the SDK's native code is compiled into the RUNNING binary.
   *
   * Not the same question as "is this iOS": a JavaScript-only over-the-air update can ship code
   * that calls the SDK ahead of the native build that contains it. Gate on this before offering a
   * payment surface, so an app on an older binary falls back instead of rendering something that
   * cannot work. True on iOS and Android alike: it does not promise support for any payment
   * method, so check `presentationCapabilities` and then `capabilities(order)`.
   */
  isNativeModuleAvailable: isNativeBridgeAvailable(Platform.OS, NativeModules.MeldModule),

  /** One-time setup. Mirrors `Meld.configure(environment:)` on native. */
  configure(environment: MeldEnvironment): void {
    NativeModules.MeldModule.configure(environment);
  },

  /**
   * Inspect an order before rendering `<MeldWidget>` — guard on surface !== 'unsupported' and size
   * the component by `embeddable`. Async because it crosses the native bridge (the web/iOS
   * equivalent is synchronous).
   */
  capabilities(order: MeldOrder): Promise<MeldCapabilities> {
    return inspectCapabilities(order, NativeModules.MeldModule);
  },

  /**
   * Whether this device can pay with a payment method at all, asked before you quote: for example,
   * whether to show an Apple Pay or Google Pay entry point. `ready`: offer it. `unavailable`: leave it
   * out; `code` is `PAYMENT_METHOD_UNAVAILABLE`. `unknown`: nothing on the device decides it (a card),
   * or the SDK could not tell, so you may offer it. Ask `presentationReadiness` about each quote row.
   *
   * A binary without the native check answers `unavailable` for the other platform's wallet and
   * `unknown` otherwise.
   */
  paymentMethodReadiness(paymentMethodType: string): Promise<MeldReadiness> {
    return inspectPaymentMethodReadiness(paymentMethodType, Platform.OS, NativeModules.MeldModule);
  },

  presentationCapabilities,

  /**
   * Whether this device can pay with a quote row's method, asked before you create the order. Pass
   * the row (its `paymentMethodType` and `headlessPresentation`). `ready`: offer it. `unavailable`:
   * hide it; `code` is `PAYMENT_METHOD_UNAVAILABLE` and no order exists. `unknown`: the SDK could
   * not tell, so you may offer it. Advisory: the mounted order still has the final word.
   *
   * A binary without the native check answers from presentation support alone.
   */
  presentationReadiness(row: MeldPresentationRow): Promise<MeldReadiness> {
    return inspectPresentationReadiness(row, NativeModules.MeldModule);
  },
};

/**
 * Inputs a native Apple Pay sheet needs beyond what the order carries. Everything here is data the
 * order was created with. Shared-action protocols resolve wallet and request IP on the server.
 * The native adapter validates which fields its declared protocol needs; callers do not select
 * a provider-specific endpoint.
 *
 * Amount/currency must match the order. Wallet/IP are required only for historical native-token
 * orders; when supplied, they must match that order's original inputs.
 */
export interface MeldApplePayRequest {
  /** Fiat amount as a decimal string, e.g. "15.00". */
  amount: string;
  /** Fiat currency, ISO 4217, e.g. "EUR". */
  currencyCode: string;
  /** Destination wallet; required only by historical native-token orders. */
  walletAddress?: string;
  /** Original device IP; required only by historical native-token orders. */
  clientIpAddress?: string;
  email?: string;
  /** Line-item label on the sheet (Apple prepends "Pay "). */
  summaryItemLabel?: string;
}

// The native component (registered by MeldWidgetManager). Events arrive under `nativeEvent`.
interface NativeProps {
  style?: ViewStyle;
  order: MeldOrder;
  applePay?: MeldApplePayRequest;
  accessibilityElementsHidden?: boolean;
  importantForAccessibility?: 'auto' | 'yes' | 'no' | 'no-hide-descendants';
  onReady?: (e: { nativeEvent: { orderId?: string } }) => void;
  onPaymentSubmitted?: (e: { nativeEvent: { orderId?: string } }) => void;
  onStatusChange?: (e: { nativeEvent: MeldStatusChange }) => void;
  onCancel?: (e: { nativeEvent: { orderId?: string } }) => void;
  onError?: (e: { nativeEvent: MeldError }) => void;
}
const NativeMeldWidget = requireNativeComponent<NativeProps>('MeldWidget');

export interface MeldWidgetProps {
  style?: ViewStyle;
  /**
   * Hide the surface from assistive tech. A provider page kept off-screen while its own sheet is
   * presented over the top has nothing to announce, and a native sheet draws nothing here at all.
   */
  accessibilityElementsHidden?: boolean;
  importantForAccessibility?: 'auto' | 'yes' | 'no' | 'no-hide-descendants';
  /** The HeadlessOrderResponse from your backend (`POST /crypto/order/headless`), passed through. */
  order: MeldOrder;
  /**
   * Required only for an Apple Pay order the provider expects US to present — the SDK builds the
   * PassKit sheet from it. Every supplied request is validated before mounting, even when the
   * selected adapter does not need it. You can pass a valid request for any `APPLE_PAY` order
   * without knowing which provider the order was routed to.
   */
  applePay?: MeldApplePayRequest;
  onReady?: (orderId?: string) => void;
  /**
   * The customer finished paying: the success terminal. Never settlement — that is your backend
   * webhook. Fires exactly once per mount, whether the provider reports it as its own "payment
   * finished" message or as a `completed` status, so no de-duplication is needed. You can unmount
   * straight away; the SDK keeps a provider-hosted page alive until it reports its outcome or 60
   * seconds pass.
   */
  onPaymentSubmitted?: (orderId?: string) => void;
  /**
   * Informational, e.g. a "Processing" label; never end the flow on it. A `failed` status is
   * followed by `onError` and a `cancelled` status by `onCancel`, so react to those instead.
   */
  onStatusChange?: (e: MeldStatusChange) => void;
  /** The flow ended without a payment; nothing will settle for this order. Terminal. */
  onCancel?: (orderId?: string) => void;
  /**
   * With `recoverable: false` the flow cannot continue: terminal, and `attemptMayExist(e.code)` says
   * whether a payment attempt may exist (unknown codes may). `recoverable: true` comes only from
   * visible embedded card widgets and is not terminal. Route on `e.code`, not `e.message`.
   */
  onError?: (e: MeldError) => void;
}

/**
 * Mounts the order's payment surface — an embedded provider widget, a provider-hosted wallet page,
 * or a native PassKit sheet. Which one is decided by the order, not by the caller: render the same
 * component for every provider and pass `applePay` whenever the order is `APPLE_PAY`.
 *
 * Apple Pay on iOS and Google Pay on Android report `embeddable: false`, so a zero-size component
 * is enough; on Android such a surface lives for the current Activity, not this view. Keep the
 * component mounted until a terminal callback: unmounting before one tears the surface down with
 * no further callback. A different `order` replaces the mount.
 *
 * On iOS and Android the SDK delivers exactly one terminal callback per mount —
 * `onPaymentSubmitted`, `onCancel`, or `onError` with `recoverable: false` — and nothing after it.
 * `onStatusChange` is informational.
 */
export function MeldWidget(props: MeldWidgetProps) {
  const { onReady, onPaymentSubmitted, onStatusChange, onCancel, onError, ...rest } = props;
  const supportedBridge = canMountOrder(props.order, NativeModules.MeldModule);
  const orderId = typeof props.order.id === 'string' ? props.order.id : undefined;
  const paymentMethodType = typeof props.order.paymentMethodType === 'string' && props.order.paymentMethodType
    ? props.order.paymentMethodType : undefined;
  const errorHandler = React.useRef(onError);
  errorHandler.current = onError;
  React.useEffect(() => {
    if (!supportedBridge) {
      errorHandler.current?.({
        orderId, code: MeldErrorCode.UNSUPPORTED_NATIVE_PROTOCOL,
        message: 'This app build does not support the order presentation. Update the native app.',
        recoverable: false, ...(paymentMethodType ? { paymentMethodType } : {}),
      });
    }
  }, [supportedBridge, orderId, paymentMethodType]);
  if (!supportedBridge) return null;
  return (
    <NativeMeldWidget
      {...rest}
      onReady={(e) => onReady?.(e.nativeEvent.orderId)}
      onPaymentSubmitted={(e) => onPaymentSubmitted?.(e.nativeEvent.orderId)}
      onStatusChange={(e) => onStatusChange?.(e.nativeEvent)}
      onCancel={(e) => onCancel?.(e.nativeEvent.orderId)}
      onError={(e) => onError?.(e.nativeEvent)}
    />
  );
}
