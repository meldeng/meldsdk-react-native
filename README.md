# @meldcrypto/react-native-sdk

React Native wrapper for the Meld SDK — embed a crypto on/off-ramp provider's payment widget
(including declared native, hosted and wallet protocols on iOS) with one component. **Supports iOS and Android**, with the same JS API and
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

This release requires **MeldSDK 0.8** for protocol dispatch, shared payment actions and native Stripe
execution. A Podfile.lock that still pins 0.7 must be updated (`pod update MeldSDK`). To test the
example against a local native checkout instead of the published pod:

```bash
cd example/ios
MELD_IOS_SDK_PATH=/absolute/path/to/meldsdk-ios POD_VERSION=0.8.0 USE_FRAMEWORKS=static pod install
```

The override compiles the native SDK from source and does not relax the minimum dependency; CI and
releases resolve the published pod.

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

Guard before rendering: `if ((await Meld.capabilities(order)).surface !== 'unsupported') { … }`
(async on RN since it crosses the native bridge). `embeddable` tells you whether the component needs
a visible area; it does not indicate whether a native sheet is supported. Keep the complete order
response, including `headlessPresentation` and `paymentActions`, and pass it through unchanged.

Declared protocols also require a compatible installed native bridge. On an older binary (including
an OTA JavaScript update), capabilities report `unsupported` and the component emits
`UNSUPPORTED_NATIVE_PROTOCOL` without mounting native UI. A new iOS app build is required. Android
currently supports legacy orders only; declared orders remain unsupported there.

### Check a quote before creating an order

```tsx
const presentation = quote.headlessPresentation;
if (!presentation) return; // Select an explicitly supported alternative; never infer from provider name.
const caps = await Meld.presentationCapabilities(quote.paymentMethodType, presentation);
if (caps.surface === 'unsupported') return;
```

The check consults the running native app's adapter registry with the exact payment method,
surface, protocol and version. It makes no provider request and needs no order or credentials.
An older bridge without this method (and Android today) returns `unsupported`, including when
new JavaScript arrives through an OTA update. Unknown or malformed declarations also fail closed.

This is advisory SDK support. Continue checking server requirements, route eligibility and device
Apple Pay readiness, then call `Meld.capabilities(order)` on the complete create response before
mounting. Preflight does not authorize an order, satisfy legal requirements or guarantee a payable
order. `embeddable: false` is valid for a supported native sheet. This API requires MeldSDK 0.8
or later.

### Apple Pay

The same component, plus an `applePay` prop carrying what the order doesn't:

```tsx
if (await Meld.canPresentApplePay()) {                 // a card in Wallet, not just a capable device
  <MeldWidget
    order={order}                                       // paymentMethodType: 'APPLE_PAY'
    applePay={{
      amount: '15.00',                                  // must match the order
      currencyCode: 'EUR',
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

Wallet address and device IP are optional for modern shared-action protocols. Historical
native-token orders still require `walletAddress` and `clientIpAddress` from their original inputs.
An explicitly malformed Apple Pay prop reports `INVALID_APPLE_PAY_REQUEST`; it is never silently
ignored. The native adapter checks any supplied amount/currency against the order where required.

The iOS view waits for attachment and, for embedded protocols, a nonzero visible layout before
mounting. Replacing order/payment inputs tears down the old mount; late callbacks from it are
discarded. Stable prop batches do not restart the payment. This preserves the same component API
for Coinbase's hosted flow, Mercuryo's wallet flow and Stripe's native SDK flow.

Native identity verification requires an app-owned `NSCameraUsageDescription`. The app must also
have the Apple Pay merchant entitlements and provider/account enrollment for the configured route.

**iOS setup.** A native sheet needs the Apple Pay entitlement in *your* app. For Expo, add the
config plugin — the merchant id is yours, and must be paired with a Payment Processing certificate
issued from the CSR your Meld representative provides:

```json
"plugins": [
  ["@meldcrypto/react-native-sdk/plugin", { "merchantIds": ["merchant.com.yourcompany.app"] }]
]
```

**One id per provider.** An Apple merchant id's tokens are encrypted for exactly one Payment
Processing Certificate, so an app offering native Apple Pay through two providers with different
processors needs an id for each — which is why this is a list:

```json
"plugins": [
  ["@meldcrypto/react-native-sdk/plugin", { "merchantIds": [
    "merchant.com.yourcompany.app",
    "merchant.com.yourcompany.app.otherprovider"
  ]}]
]
```

The singular `merchantId` is still accepted, so existing config keeps working; passing both merges
them.

Bare React Native projects add the same entitlement in Xcode. No setup is needed for
provider-hosted Apple Pay — that runs under the provider's merchant id on their own domain.

> The iOS **Simulator** presents the sheet and can authorize it (Features ▸ Face ID ▸ Matching
> Face), which is enough to exercise mounting, events and the cancel path. It cannot produce a
> decryptable payment token, so completing a real payment needs a device.

## Events

| Event | Fires when | Do |
|---|---|---|
| `onReady` | Widget document loaded | Hide spinner |
| `onPaymentSubmitted` | User finished the provider payment flow — **exactly once per mount** (UX hint only) | Unmount, show "processing" |
| `onStatusChange` | Order status changed; `e.status` is `pending` \| `completed` \| `failed` \| `cancelled` | React to status; `completed` = provider "order complete" (still not settlement) |
| `onCancel` | User cancelled | Show retry CTA |
| `onError` | Load failure, bad order, or terminal `failed` status | Show error; `e.recoverable` says retry vs. new order |

`onPaymentSubmitted` fires once and only once, however the provider signals it. Some send a
"payment finished" message and never a status; some report `completed` and never a finished
message; some send both, in either order. The native SDK collapses that into a single callback,
so you do not need a `settledOnce` guard of your own. A terminal `failed`/`cancelled` status, a
cancel, or a non-recoverable error closes it, so a failure is never followed by a submission.

`status` is normalized across providers — code against it, not the raw provider string (in
`e.providerStatus`). A terminal `failed` also fires `onError`, and a `cancelled` also fires
`onCancel`. Every callback also receives the `orderId`.

## Settlement — webhook, never the SDK

Neither `onPaymentSubmitted` nor `onStatusChange` with `status === 'completed'` is settlement —
both are client-side UX signals. Mark the order paid only when your backend receives Meld's
`TRANSACTION_CRYPTO_COMPLETE` webhook. Show "processing", not "success", until then.

## Example app

A complete, runnable demo for **both platforms** is in [`example/`](example/) — the same flow as
the iOS, Android, and web demos (live quote → wallet → Buy → mounted widget, with a status banner
and event log). See [example/README.md](example/README.md) to set up credentials and run it.

## License

Proprietary. See [LICENSE](LICENSE).
