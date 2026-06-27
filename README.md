# @meldcrypto/react-native-sdk

React Native wrapper for the Meld SDK — embed a crypto on/off-ramp provider's payment widget
(Mercuryo card today) with one component. **Supports iOS and Android**, with the same JS API and
event model on both. Wraps the native [meldsdk-ios](https://github.com/meldeng/meldsdk-ios#readme)
and [meldsdk-android](https://github.com/meldeng/meldsdk-android#readme) SDKs.

## Install

```bash
npm install @meldcrypto/react-native-sdk
```

The wrapper autolinks. The native Meld SDK it depends on isn't an RN module, so it isn't
autolinked — wire it per platform:

### iOS

`MeldSDK` (the wrapper's pod dependency) resolves by name from CocoaPods trunk, so there's nothing
to add to your `Podfile`. Just install with **static frameworks** (`MeldSDK` is a Swift pod):

```bash
cd ios && USE_FRAMEWORKS=static pod install
```

### Android

Nothing to wire up beyond autolinking: the wrapper's Gradle module pulls in the native Android SDK
(`io.meld:meldsdk`) from Maven Central, which is in the default repositories of new Android
projects. `minSdk 24`+. The Android SDK declares the `INTERNET` and `CAMERA` permissions (camera is
used for in-widget KYC); they merge into your app automatically.

> The wrapper uses RN's legacy (Paper) view/module APIs, which run on the **New Architecture via
> RN's interop layer** — the default on RN 0.85. No extra configuration is needed; `USE_FRAMEWORKS=static`
> is required only because `MeldSDK` is a Swift pod.

## Usage (identical on both platforms)

Your **backend** creates the order (your Meld API key never reaches the app); your app passes the
response to `<MeldWidget>`.

```tsx
import { Meld, MeldWidget } from '@meldcrypto/react-native-sdk';

Meld.configure('sandbox'); // or 'production'

<MeldWidget
  style={{ flex: 1 }}
  order={order}                                  // your backend's order JSON, passed through
  onReady={() => hideSpinner()}
  onPaymentSubmitted={() => showProcessing()}    // ⚠ UX hint — settlement is your webhook
  onStatusChange={(e) => { if (e.status === 'completed') showComplete(); }}
  onCancel={() => showRetryCTA()}
  onError={(e) => showError(e.message)}          // also fires on INVALID_ORDER / MOUNT_FAILED
/>
```

Optionally guard before rendering: `if ((await Meld.capabilities(order)).embeddable) { … }`
(async on RN since it crosses the native bridge).

## Events

| Event | Fires when | Do |
|---|---|---|
| `onReady` | Widget document loaded | Hide spinner |
| `onPaymentSubmitted` | User finished the provider payment flow (UX hint only) | Show "processing" |
| `onStatusChange` | Order status changed; `e.status` is `pending` \| `completed` \| `failed` \| `cancelled` | React to status; `completed` = provider "order complete" (still not settlement) |
| `onCancel` | User cancelled | Show retry CTA |
| `onError` | Load failure, bad order, or terminal `failed` status | Show error; `e.recoverable` says retry vs. new order |

`status` is normalized across providers — code against it, not the raw provider string (in
`e.providerStatus`). A terminal `failed` also fires `onError`, and a `cancelled` also fires
`onCancel`. Every callback also receives the `orderId`.

## Native Apple Pay (Mercuryo NAP)

When your backend creates an order with `paymentMethodType: 'APPLE_PAY'`, it isn't an embeddable
widget — it's a native Apple Pay sheet (`capabilities(order).surface === 'native-applepay'`,
`embeddable === false`). There's no `<MeldWidget>` to render; call `Meld.presentApplePay` directly.
**iOS only** (Apple Pay isn't available on Android).

```tsx
import { Meld } from '@meldcrypto/react-native-sdk';

Meld.configure('production');

// Gate your button on availability (false on Android / no card / restricted).
const canApplePay = await Meld.canPresentApplePay();

// order = the APPLE_PAY HeadlessOrderResponse from your backend.
try {
  await Meld.presentApplePay(order, {
    amount: '15.00',
    currencyCode: 'EUR',
    walletAddress: 'bc1q…',
    clientIpAddress: deviceIp,        // same IP used when the order was created
    summaryItemLabel: 'Acme — Buy BTC',
  });
  // resolved → payment authorized & accepted (status pending/completed). Show "processing".
} catch (e) {
  // e.code: 'cancelled' | 'failed' | 'error' | 'unavailable' | 'invalid_order' | 'bad_request'
}
```

**Prerequisites (one-time, in your Apple Developer account):** an Apple Pay **merchant identifier**
with the **Payment Processing** + **Merchant Identity** certificates registered with Meld for your
account, and the **Apple Pay capability** enabled on your app target with that same merchant id
(the order's `merchantIdentifier`) in your entitlements. This is a bare-RN package — add the
entitlement in Xcode (or your own config plugin); we don't inject it for you. Mercuryo NAP does
**not** process US/GB users — use a supported corridor (EU/CA).

## Settlement — webhook, never the SDK

Neither `onPaymentSubmitted` nor `onStatusChange` with `status === 'completed'` is settlement —
both are client-side UX signals. Mark the order paid only when your backend receives Meld's
`TRANSACTION_STATUS_CHANGED` webhook. Show "processing", not "success", until then.

## Example app

A complete, runnable demo for **both platforms** is in [`example/`](example/) — the same flow as
the iOS, Android, and web demos (live quote → wallet → Buy → mounted widget, with a status banner
and event log). See [example/README.md](example/README.md) to set up credentials and run it.

## License

Proprietary. See [LICENSE](LICENSE).
