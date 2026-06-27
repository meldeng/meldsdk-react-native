import React from 'react';
import { Platform, requireNativeComponent, NativeModules, type ViewStyle } from 'react-native';

export type MeldEnvironment = 'sandbox' | 'production';
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
   * Whether native Apple Pay can be presented now (device/user can pay, and we're on iOS).
   * Apple Pay is iOS-only — always resolves `false` on Android.
   */
  canPresentApplePay(): Promise<boolean> {
    if (Platform.OS !== 'ios' || !NativeModules.MeldApplePay) return Promise.resolve(false);
    return NativeModules.MeldApplePay.isAvailable();
  },

  /**
   * Present the native Apple Pay sheet for a Mercuryo native Apple Pay (NAP) order — an order
   * created with `paymentMethodType: 'APPLE_PAY'`. There is NO `<MeldWidget>` for this surface
   * (`capabilities(order).surface === 'native-applepay'`, `embeddable === false`); the SDK presents
   * the system sheet itself. Resolves on a successful/pending payment; rejects with
   * `code: 'cancelled' | 'failed' | 'error' | 'unavailable' | 'invalid_order' | 'bad_request'`.
   *
   * `request` supplies what the order doesn't carry (amount/currency/wallet/IP). `clientIpAddress`
   * must be the same device IP used when the order was created (Mercuryo binds the tx to it).
   * Settlement is still your backend webhook, not this promise.
   */
  presentApplePay(order: MeldOrder, request: MeldApplePayRequest): Promise<MeldApplePayResult> {
    if (Platform.OS !== 'ios' || !NativeModules.MeldApplePay) {
      return Promise.reject(new Error('Apple Pay is only available on iOS'));
    }
    return NativeModules.MeldApplePay.presentApplePay(order, request);
  },
};

/** Inputs the Apple Pay sheet needs beyond what the order carries. */
export interface MeldApplePayRequest {
  /** Fiat amount as a decimal string, e.g. "15.00". Matches the order's source amount. */
  amount: string;
  /** Fiat currency, ISO 4217, e.g. "EUR". Matches the order's source currency. */
  currencyCode: string;
  /** Destination crypto wallet address. */
  walletAddress: string;
  /** Device public IP — Mercuryo binds the tx to it; use the same IP as order creation. */
  clientIpAddress: string;
  email?: string;
  /** Line-item label on the sheet (Apple prepends "Pay "). */
  summaryItemLabel?: string;
}

export interface MeldApplePayResult {
  status: 'success';
}

// The native component (registered by MeldWidgetManager). Events arrive under `nativeEvent`.
interface NativeProps {
  style?: ViewStyle;
  order: MeldOrder;
  onReady?: (e: { nativeEvent: { orderId?: string } }) => void;
  onPaymentSubmitted?: (e: { nativeEvent: { orderId?: string } }) => void;
  onStatusChange?: (e: { nativeEvent: MeldStatusChange }) => void;
  onCancel?: (e: { nativeEvent: { orderId?: string } }) => void;
  onError?: (e: { nativeEvent: MeldError }) => void;
}
const NativeMeldWidget = requireNativeComponent<NativeProps>('MeldWidget');

export interface MeldWidgetProps {
  style?: ViewStyle;
  /** The HeadlessOrderResponse from your backend (`POST /crypto/order/headless`), passed through. */
  order: MeldOrder;
  onReady?: (orderId?: string) => void;
  onPaymentSubmitted?: (orderId?: string) => void;
  onStatusChange?: (e: MeldStatusChange) => void;
  onCancel?: (orderId?: string) => void;
  onError?: (e: MeldError) => void;
}

/**
 * Mounts the provider widget. Same lifecycle as the native SDK: terminal `failed` also fires
 * `onError`, `cancelled` also fires `onCancel`. `completed` is the provider's "order complete",
 * not settlement — that's your backend webhook.
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
