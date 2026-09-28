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
  onStatusChange={(e) => showStatus(e.status)}   // informational, never the end of the flow
  onPaymentSubmitted={() => showProcessing()}    // success ⚠ settlement is your webhook
  onCancel={() => backToCheckout()}              // nothing will settle for this order
  onError={(e) => handleError(e)}                // route on e.code (see Events)
/>
```

Guard before rendering: `if ((await Meld.capabilities(order)).surface !== 'unsupported') { … }`
(async on RN since it crosses the native bridge). `embeddable` tells you whether the component needs
a visible area; it does not indicate whether a native sheet is supported. Keep the complete order
response, including `headlessPresentation` and `paymentActions`, and pass it through unchanged.

Declared protocols also depend on the installed native bridge. A bridge without MeldSDK 0.8's
protocol registry (Android today, or an older iOS binary running this JavaScript through an OTA
update) still mounts the version 1 declarations its native dispatch already presents:
`MERCURYO_WIDGET`, `UPHOLD_WIDGET` and `BANXA_CHECKOUT` cards, plus `BANXA_CHECKOUT`,
`COINBASE_APPLE_PAY` and `MELD_WALLET_TOKEN` Apple Pay on iOS. An older iOS binary presents
`MELD_WALLET_TOKEN` through its historical path, which needs `walletAddress` and `clientIpAddress`.
For any other declaration, such as `STRIPE_CRYPTO_ONRAMP`, capabilities report `unsupported` and
the component emits `UNSUPPORTED_NATIVE_PROTOCOL` without mounting native UI. Those need a new iOS
app build.

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
sheet on their own page, which the SDK loads off-screen before opening that page's Apple Pay sheet.
Either way the customer sees only Apple's sheet. The prop is read only by the surfaces that need
it (a provider-hosted page does not use it), and choosing between them is the SDK's job — that is
the point of one component.

On iOS, both report `surface: 'native-applepay'` and `embeddable: false`: the SDK presents the
payment UI, so the component needs no visible area and a zero-size component is enough. Both also
report `requiresUserGesture: true`, so mount from the customer's tap on your Apple Pay button. A
provider-hosted page needs iOS 16 or later; on iOS 15 its capabilities report `unsupported`, so
leave that option out. If there is no window to present it from, the component reports
`MOUNT_FAILED`.

A native sheet is modal, so nothing draws in the view while it is up. Keep the component mounted
until a terminal callback (see [Events](#events)). Unmounting before one tears the surface down
with no further callback, so the order's outcome is whatever your backend reports. After
`onPaymentSubmitted` you can unmount straight away: the SDK keeps a provider-hosted page alive on
its own until the page reports its outcome, or 60 seconds pass, so unmounting does not cut the
provider off.

Wallet address and device IP are optional for modern shared-action protocols. Historical
native-token orders still require `walletAddress` and `clientIpAddress` from their original inputs.
An explicitly malformed Apple Pay prop reports `INVALID_APPLE_PAY_REQUEST`; it is never silently
ignored. The native adapter checks any supplied amount/currency against the order where required.

The iOS view mounts once it is in a window and, for embedded protocols, has a nonzero size. An
embedded surface still zero-size 2 seconds after attaching reports `MOUNT_FAILED` and is not mounted
later. Leaving the window (a pushed screen, another tab, a full-screen modal) neither ends nor
restarts the payment, and its callbacks keep arriving; only unmounting the component ends it.
Replacing the order tears down the old mount and discards its late callbacks, and so does changing
`applePay` on an `APPLE_PAY` order. Other prop batches, including a rebuilt `applePay` on a card
order, do not restart the payment. This preserves the same component API for Coinbase's hosted
flow, Mercuryo's wallet flow and Stripe's native SDK flow.

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
| `onReady` | The widget loaded, or the Apple Pay sheet is opening | Hide spinner |
| `onPaymentSubmitted` | The customer finished paying — **exactly once per mount**. The success terminal | Unmount, show "processing" (settlement is your webhook) |
| `onStatusChange` | Order status changed; `e.status` is `pending` \| `completed` \| `failed` \| `cancelled` | Informational, e.g. a "Processing" label; never end the flow on it |
| `onCancel` | The flow ended without a payment. Terminal | Back to checkout; the next attempt is a new order |
| `onError` | The flow cannot continue (`recoverable: false`, terminal), or an embedded card widget hit a problem the customer can fix in place (`recoverable: true`, not terminal) | Route on `e.code` (below) |

`onPaymentSubmitted` fires once and only once, however the provider signals it. Some send a
"payment finished" message and never a status; some report `completed` and never a finished
message; some send both, in either order. The native SDK collapses that into a single callback,
so you do not need a `settledOnce` guard of your own, and a `completed` status is never a second
success signal. A terminal `failed`/`cancelled` status, a cancel, or a non-recoverable error closes
it, so a failure is never followed by a submission.

`status` is normalized across providers — code against it, not the raw provider string (in
`e.providerStatus`). A `failed` status is followed by `onError`, and a `cancelled` status by
`onCancel`, so react to those callbacks rather than to the status. `pending` means the provider is
processing and promises nothing by itself. Every callback also receives the `orderId`.

### Terminal contract (iOS)

On iOS, from mount until you unmount the component, the SDK delivers **exactly one** terminal
callback, and nothing after it: no `onStatusChange` and no `onReady`.

- `onPaymentSubmitted`: the payment was submitted. Settlement arrives by webhook.
- `onCancel`: nothing will settle for this order.
- `onError` with `recoverable: false`: `e.code` says whether a payment attempt may exist.

`recoverable: true` comes only from visible embedded card widgets, and is not terminal. Unmounting
before a terminal callback delivers none.

| `e.code` | A payment attempt may exist? | Do |
|---|---|---|
| `APPLE_PAY_UNAVAILABLE` | no | Offer hosted checkout or another method |
| `PRESENTATION_FAILED` | no | Back to your CTA; the next tap creates a new order |
| `PAYMENT_REJECTED` | no (declined) | Ask the customer to choose another option |
| `ORDER_STATE_CHANGED` | no | Create a new order |
| `VERIFICATION_PENDING` | no | Tell the customer the provider is reviewing |
| `PAYMENT_OUTCOME_UNKNOWN` | **yes** | Follow the order through your backend; never pay this order again |
| `INVALID_ORDER`, `INVALID_APPLE_PAY_REQUEST`, `MOUNT_FAILED`, `UNSUPPORTED_NATIVE_PROTOCOL` | no (nothing was mounted) | Fix the input, or fall back |

Treat any other code as "a payment attempt may exist", including provider-specific ones such as
`WAIT_FOR_PAYMENT` or `VERIFICATION_WINDOW_EXPIRED`. `e.detail` carries the raw provider event and
code (for example `onramp_api.load_error:ERROR_CODE_GUEST_APPLE_PAY_NOT_SUPPORTED`), for logging
only.

Android does not enforce this contract yet. There, `onPaymentSubmitted` also fires once per mount,
and a `completed` status also produces it, but statuses and other callbacks can still arrive after
a terminal one, so ignore anything that follows your first terminal callback. Apple Pay is
iOS-only.

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
