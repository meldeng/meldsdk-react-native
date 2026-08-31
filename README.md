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

### Apple Pay

The same component, plus an `applePay` prop carrying what the order doesn't:

```tsx
if (await Meld.canPresentApplePay()) {                 // a card in Wallet, not just a capable device
  <MeldWidget
    order={order}                                       // paymentMethodType: 'APPLE_PAY'
    applePay={{
      amount: '15.00',                                  // must match the order
      currencyCode: 'EUR',
      walletAddress: 'bc1q…',
      clientIpAddress: deviceIp,                        // the SAME IP the order was created with
      summaryItemLabel: 'Acme — Buy BTC',
    }}
    onPaymentSubmitted={() => showProcessing()}
    onCancel={() => backToCheckout()}
    onError={(e) => showError(e.message)}
  />
}
```

Pass `applePay` for **any** `APPLE_PAY` order without checking which provider it routed to. Some
providers hand back a token the SDK presents through PassKit as a native sheet; others host the
sheet on their own page, which the SDK renders into this component. The prop is read only by the
surfaces that need it, and choosing between them is the SDK's job — that is the point of one
component.

A native sheet is modal, so nothing draws in the view while it is up. Keep the component mounted
anyway: unmounting tears the surface down.

**iOS setup.** A native sheet needs the Apple Pay entitlement in *your* app. For Expo, add the
config plugin — the merchant id is yours, and must be paired with a Payment Processing certificate
issued from the CSR your Meld representative provides:

```json
"plugins": [
  ["@meldcrypto/react-native-sdk/plugin", { "merchantId": "merchant.com.yourcompany.app" }]
]
```

Bare React Native projects add the same entitlement in Xcode. No setup is needed for
provider-hosted Apple Pay — that runs under the provider's merchant id on their own domain.

> The iOS **Simulator** presents the sheet and can authorize it (Features ▸ Face ID ▸ Matching
> Face), which is enough to exercise mounting, events and the cancel path. It cannot produce a
> decryptable payment token, so completing a real payment needs a device.

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
