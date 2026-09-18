import React from 'react';
import { parseHeadlessError } from './headlessError';
import type { MeldHeadlessError } from './headlessError';
export type { MeldHeadlessError, MeldHeadlessErrorCategory, MeldHeadlessErrorRecovery } from './headlessError';
import { requireNativeComponent, NativeModules, Platform, type ViewStyle } from 'react-native';
import { canMountOrder, inspectCapabilities, inspectPresentationCapabilities, type MeldHeadlessPresentation } from './nativeSupport';

export type { MeldHeadlessPresentation } from './nativeSupport';

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
  code: string;
  message: string;
  /** Extra diagnostic detail when the SDK has it (e.g. an NSError domain/code). May be empty. */
  detail?: string;
  /** Whether this mounted flow can continue. False never authorizes a new order or payment. */
  recoverable: boolean;
  /** Validated advice from shared action failures; absent on older binaries and legacy surfaces. */
  headlessError?: MeldHeadlessError;
}

export interface MeldCapabilities {
  /** Whether the surface needs a visible host. Check surface !== 'unsupported' for support. */
  embeddable: boolean;
  surface: string;
  requiresUserGesture: boolean;
}

export const Meld = {
  /**
   * True when the SDK's native code is compiled into the RUNNING binary.
   *
   * Not the same question as "is this iOS": a JavaScript-only over-the-air update can ship code
   * that calls the SDK ahead of the native build that contains it. Gate on this before offering a
   * payment surface, so an app on an older binary falls back instead of rendering something that
   * cannot work.
   */
  isNativeModuleAvailable: Platform.OS === 'ios' && NativeModules.MeldModule != null,

  /**
   * One-time setup. Mirrors `Meld.configure(environment:)` on native.
   *
   * NOTE: `'qa'` is honoured on iOS only. The Android SDK's environment enum has just
   * sandbox/production, so it resolves `'qa'` to sandbox — which would point an Android card
   * widget at the wrong host for a QA order. Warned rather than silently accepted; remove this
   * once the Android SDK carries a QA case.
   */
  configure(environment: MeldEnvironment): void {
    if (environment === 'qa' && Platform.OS !== 'ios') {
      console.warn(
        "[MeldSDK] configure('qa') is iOS-only; this platform will use sandbox. " +
          'Orders created in QA will not resolve here.',
      );
    }
    NativeModules.MeldModule.configure(environment);
  },

  /**
   * Inspect an order before rendering `<MeldWidget>` — guard on surface !== 'unsupported'. Async because it
   * crosses the native bridge (the web/iOS equivalent is synchronous).
   */
  capabilities(order: MeldOrder): Promise<MeldCapabilities> {
    return inspectCapabilities(order, NativeModules.MeldModule);
  },

  /**
   * Advisory support for a quote or payment method's declared presentation before creating an
   * order. The installed native adapter registry owns support, including on OTA-updated apps.
   * Missing bridge support returns `unsupported`. Still check eligibility, device readiness and
   * legal requirements, then call `capabilities(order)` with the actual order before mounting it.
   */
  presentationCapabilities(paymentMethodType: string, presentation: MeldHeadlessPresentation): Promise<MeldCapabilities> {
    return inspectPresentationCapabilities(paymentMethodType, presentation, NativeModules.MeldModule);
  },

  /**
   * Whether this device and user can pay with Apple Pay right now — a card is provisioned and
   * payments aren't restricted. Check before offering the option rather than after: a button that
   * can never open a sheet is worse than no button.
   *
   * Always false off iOS, and false when the native module isn't in this binary.
   */
  canPresentApplePay(): Promise<boolean> {
    if (Platform.OS !== 'ios' || NativeModules.MeldModule == null) {
      return Promise.resolve(false);
    }
    return NativeModules.MeldModule.canPresentApplePay();
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
   * The customer finished paying. A UX hint, never settlement — unmount and show a processing
   * state. Fires exactly once per mount, whether the provider reports it as its own "payment
   * finished" message or as a `completed` status, so no de-duplication is needed.
   */
  onPaymentSubmitted?: (orderId?: string) => void;
  onStatusChange?: (e: MeldStatusChange) => void;
  onCancel?: (orderId?: string) => void;
  onError?: (e: MeldError) => void;
}

/**
 * Mounts the order's payment surface — an embedded provider widget, a provider-hosted Apple Pay
 * page, or a native PassKit sheet. Which one is decided by the order, not by the caller: render the
 * same component for every provider and pass `applePay` whenever the order is `APPLE_PAY`.
 *
 * A native sheet is modal, so nothing appears in this view while it is up; keep the component
 * mounted regardless, since unmounting it tears the surface down.
 *
 * Same lifecycle as the native SDK: terminal `failed` also fires `onError`, `cancelled` also fires
 * `onCancel`. `completed` is the provider's "order complete", not settlement — that's your backend
 * webhook.
 */
export function MeldWidget(props: MeldWidgetProps) {
  const { onReady, onPaymentSubmitted, onStatusChange, onCancel, onError, ...rest } = props;
  const supportedBridge = canMountOrder(props.order, NativeModules.MeldModule);
  const orderId = typeof props.order.id === 'string' ? props.order.id : undefined;
  const errorHandler = React.useRef(onError);
  errorHandler.current = onError;
  React.useEffect(() => {
    if (!supportedBridge) {
      errorHandler.current?.({
        orderId, code: 'UNSUPPORTED_NATIVE_PROTOCOL',
        message: 'This app build does not support the order presentation. Update the native app.',
        recoverable: false,
      });
    }
  }, [supportedBridge, orderId]);
  if (!supportedBridge) return null;
  return (
    <NativeMeldWidget
      {...rest}
      onReady={(e) => onReady?.(e.nativeEvent.orderId)}
      onPaymentSubmitted={(e) => onPaymentSubmitted?.(e.nativeEvent.orderId)}
      onStatusChange={(e) => onStatusChange?.(e.nativeEvent)}
      onCancel={(e) => onCancel?.(e.nativeEvent.orderId)}
      onError={(e) => onError?.({...e.nativeEvent, headlessError: parseHeadlessError(e.nativeEvent.headlessError)})}
    />
  );
}
