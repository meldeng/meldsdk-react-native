import React from 'react';
import { requireNativeComponent, NativeModules, Platform, type ViewStyle } from 'react-native';

export type MeldEnvironment = 'sandbox' | 'qa' | 'production';
export type MeldStatus = 'pending' | 'completed' | 'failed' | 'cancelled';

/**
 * The `HeadlessOrderResponse` from your backend (`POST /crypto/order/headless`). The SDK forwards
 * it to the native layer verbatim and never reads individual fields, so this is an open JSON
 * object (string keys, `unknown` values) rather than a fixed schema — but it's narrower than
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
  /** Whether retrying the same order may succeed (vs. needing a new order). */
  recoverable: boolean;
}

export interface MeldCapabilities {
  /** True if this SDK can embed the order with `<MeldWidget>`. Guard on this before rendering. */
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

  /** One-time setup. Mirrors `Meld.configure(environment:)` on native. */
  configure(environment: MeldEnvironment): void {
    NativeModules.MeldModule.configure(environment);
  },

  /**
   * Inspect an order before rendering `<MeldWidget>` — guard on `.embeddable`. Async because it
   * crosses the native bridge (the web/iOS equivalent is synchronous).
   */
  capabilities(order: MeldOrder): Promise<MeldCapabilities> {
    return NativeModules.MeldModule.capabilities(order);
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
 * order was created with — the duplication is a wart of today's contract, not a design: once the
 * backend serves the payment-request recipe on the order, only `clientIpAddress` (which only the
 * device knows) and your own label remain.
 *
 * `amount`, `currencyCode` and `walletAddress` MUST match the order. `clientIpAddress` must be the
 * same device IP the order was created with — the provider binds the transaction to it.
 */
export interface MeldApplePayRequest {
  /** Fiat amount as a decimal string, e.g. "15.00". */
  amount: string;
  /** Fiat currency, ISO 4217, e.g. "EUR". */
  currencyCode: string;
  /** Destination crypto wallet address. */
  walletAddress: string;
  /** The device's public IP — the same value sent at order creation. */
  clientIpAddress: string;
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
   * PassKit sheet from it. Ignored for every other surface, including provider-hosted Apple Pay,
   * so you can pass it unconditionally for an `APPLE_PAY` order without knowing which provider
   * the order was routed to. That is the point: the shape is the SDK's business, not yours.
   */
  applePay?: MeldApplePayRequest;
  onReady?: (orderId?: string) => void;
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
