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

This release (0.10.0) requires **MeldSDK 0.10.x** (`~> 0.10.0`) for the readiness checks, on top of
the protocol dispatch, shared payment actions and native Stripe execution that 0.8 introduced. It
does not compile against 0.9.

**Before you upgrade, remove any MeldSDK pin of your own, or raise it to `~> 0.10.0`.** The wrapper's
podspec already brings MeldSDK, so your app needs no pin. Look for a Podfile line such as
`pod 'MeldSDK', '~> 0.9.0'`, and in Expo for an `expo-build-properties` entry such as
`"extraPods": [{ "name": "MeldSDK", "version": "~> 0.9.0" }]` (prebuild again after changing it).
`pod update MeldSDK` does not change an explicit pin, and while one excludes 0.10, `pod install`
cannot find compatible versions for MeldSDK. Then update a Podfile.lock that still holds 0.8 or 0.9
with `pod update MeldSDK`.

To test the example against a local native checkout instead of the published pod:

```bash
cd example/ios
MELD_IOS_SDK_PATH=/absolute/path/to/meldsdk-ios POD_VERSION=0.10.0 USE_FRAMEWORKS=static pod install
```

The override compiles the native SDK from source and does not relax the minimum dependency; CI and
releases resolve the published pod.

### Android

Nothing to wire up beyond autolinking: the wrapper's Gradle module pulls in the native Android SDK
(`io.meld:meldsdk`) from Maven Central, which is in the default repositories of new Android
projects. `minSdk 24`+. The Android SDK declares the `INTERNET` and `CAMERA` permissions (camera is
used for in-widget KYC); they merge into your app automatically.

This release requires **io.meld:meldsdk 0.8.0** for readiness checks, on top of the protocol
dispatch 0.7.0 introduced. To build against an unreleased native checkout instead, publish it to
Maven Local and pass the same version to the app build:

```bash
# in meldsdk-android
./gradlew :meldsdk:publishToMavenLocal -PmeldsdkVersion=0.8.0-local
# in the app's android/ directory (or export ORG_GRADLE_PROJECT_meldSdkVersion=0.8.0-local)
./gradlew :app:assembleDebug -PmeldSdkVersion=0.8.0-local
```

The override searches Maven Local for the `io.meld` group only. Without it the wrapper resolves
the published version.

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
(async on RN since it crosses the native bridge). Branch only on two things:

- **`surface === 'unsupported'`:** this app build cannot present the order here. Do not render it;
  offer another method.
- **`embeddable`:** true means the payment renders into the component, so give it room. False
  means it needs no visible area, and a zero-size component is enough. It does not indicate whether
  a native sheet is supported.

Every other `surface` value is informational. iOS reports values such as `native-applepay`,
Android `embedded` and `native-wallet`, and new values may appear without notice, so never branch
on them. `requiresUserGesture: true` means: mount from the customer's tap. Keep the complete order
response, including `headlessPresentation` and `paymentActions`, and pass it through unchanged.

Declared protocols also depend on the installed native bridge. A bridge without a protocol
registry (an iOS binary before MeldSDK 0.8 or an Android binary before io.meld:meldsdk 0.7.0,
including one running this JavaScript through an OTA update) still mounts the version 1
declarations its native dispatch already presents: `MERCURYO_WIDGET`, `UPHOLD_WIDGET` and
`BANXA_CHECKOUT` cards, plus `BANXA_CHECKOUT`, `COINBASE_APPLE_PAY` and `MELD_WALLET_TOKEN` Apple
Pay on iOS. An older iOS binary presents `MELD_WALLET_TOKEN` through its historical path, which
needs `walletAddress` and `clientIpAddress`. For any other declaration, such as
`STRIPE_CRYPTO_ONRAMP` or Coinbase `GOOGLE_PAY`, capabilities report `unsupported` and the
component emits `UNSUPPORTED_NATIVE_PROTOCOL` without mounting native UI. Those need a new native
app build.

On Android the registry presents version 1 `MERCURYO_WIDGET`, `UPHOLD_WIDGET` and `BANXA_CHECKOUT`
cards, and `GOOGLE_PAY` on `PROVIDER_HOSTED` with `COINBASE_PAYMENT_LINK`. It declines every Apple
Pay protocol.

### Check the device before you quote

Ask whether this device can pay with a payment method at all before you request a quote, for
example to decide whether to show an Apple Pay or Google Pay entry point. No provider or quote row
is needed:

```tsx
const readiness = await Meld.paymentMethodReadiness('APPLE_PAY');
if (readiness.status === 'unavailable') leaveOut('APPLE_PAY'); // readiness.code is PAYMENT_METHOD_UNAVAILABLE
```

| `paymentMethodType` | iOS | Android |
|---|---|---|
| `APPLE_PAY` | `ready` when payments aren't restricted and Wallet holds a card on a network one of the SDK's Apple Pay presentations takes, otherwise `unavailable` | `unavailable` |
| `GOOGLE_PAY` | `unavailable` | `ready` when Google Pay holds a Visa, Mastercard, American Express or Discover card, otherwise `unavailable`; `unknown` when Google Play services is missing, out of date or slow, and in place of `unavailable` when configured for `'sandbox'` or `'qa'` |
| Any other, such as `CREDIT_DEBIT_CARD` | `unknown` | `unknown` |

`unknown` means nothing on the device decides the method, or the SDK could not tell, so you may
offer it. `ready` does not mean every provider takes the customer's card (Mercuryo takes only Visa
and Mastercard), so ask again for each quote row ([below](#check-readiness-before-creating-an-order)).
The check is advisory, makes no provider request and needs MeldSDK 0.10 on iOS or io.meld:meldsdk
0.8.0 on Android. A binary from before them, including one running this JavaScript through an OTA
update, answers `unavailable` for the other platform's wallet (Apple Pay on Android, Google Pay on
iOS) and `unknown` for everything else.

### Check a quote before creating an order

Pass the quote row (`POST /payments/crypto/quote?integrationMode=HEADLESS`); the SDK reads only its
`paymentMethodType` and `headlessPresentation`:

```tsx
if (!quote.headlessPresentation) return; // Select an explicitly supported alternative; never infer from provider name.
const caps = await Meld.presentationCapabilities(quote);
if (caps.surface === 'unsupported') return;
```

The positional form, `Meld.presentationCapabilities(quote.paymentMethodType, quote.headlessPresentation)`,
still works. The check consults the running native app's adapter registry with the exact payment
method, surface, protocol and version. It makes no provider request and needs no order or
credentials. An older bridge without this method (iOS before MeldSDK 0.8, Android before
io.meld:meldsdk 0.7.0) returns `unsupported`, including when new JavaScript arrives through an OTA
update. Unknown or malformed declarations also fail closed.

This is advisory SDK support. Continue checking server requirements, route eligibility and device
readiness (below), then call `Meld.capabilities(order)` on the complete create response before
mounting. Preflight does not authorize an order, satisfy legal requirements or guarantee a payable
order. `embeddable: false` is valid for a supported native sheet. This API requires MeldSDK 0.8 on
iOS or io.meld:meldsdk 0.7.0 on Android, or later.

### Check readiness before creating an order

Ask whether this device can pay with a quote row's method before you create the order, so a
customer who cannot pay is not offered Apple Pay or Google Pay:

```tsx
const readiness = await Meld.presentationReadiness(quote);
switch (readiness.status) {
  case 'ready': offer(quote); break;
  case 'unknown': offer(quote); break;    // could not tell; the payment has the final word
  case 'unavailable': hide(quote); break; // readiness.code is PAYMENT_METHOD_UNAVAILABLE
}
```

- **`ready`:** offer the method.
- **`unavailable`:** hide the method. `code` is `PAYMENT_METHOD_UNAVAILABLE`. The SDK does not
  present the row's declaration here, or the device or wallet cannot pay with it (Apple Pay through
  PassKit on iOS, Google Pay through Google Play services on Android). No order exists, so there is
  nothing to track.
- **`unknown`:** the SDK could not tell. You may offer the method. Card rows answer `unknown` on
  iOS and Android alike, because nothing on the device decides whether a card pays. So do, on iOS,
  provider pages whose merchant account decides which Wallet cards it takes.

`reason` explains the answer, for logging only. Readiness is advisory and makes no provider request.
If you create the order anyway, the mounted payment still reports `onError` with
`PAYMENT_METHOD_UNAVAILABLE` when it cannot pay, and that is the final word. The native check needs
MeldSDK 0.10 on iOS or io.meld:meldsdk 0.8.0 on Android. A binary from before them, including one
running this JavaScript through an OTA update, answers from `presentationCapabilities`:
`unavailable` where that is `unsupported`, otherwise `unknown`.

`Meld.canPresentApplePay()` was removed in 0.10.0. `Meld.paymentMethodReadiness('APPLE_PAY')` makes
the same device check, and the row's readiness knows the provider.

### Apple Pay

The same component, plus an `applePay` prop carrying what the order doesn't:

```tsx
// Offered only for a quote row whose Meld.presentationReadiness(quote) was not 'unavailable'.
<MeldWidget
  order={order}                                         // paymentMethodType: 'APPLE_PAY'
  applePay={{
    amount: '15.00',                                    // must match the order
    currencyCode: 'EUR',
    summaryItemLabel: 'Acme — Buy BTC',
  }}
  onPaymentSubmitted={() => showProcessing()}
  onCancel={() => backToCheckout()}
  onError={(e) => showError(e.message)}
/>
```

Pass `applePay` for **any** `APPLE_PAY` order without checking which provider it routed to. Some
providers hand back a token the SDK presents through PassKit as a native sheet; others host the
sheet on their own page, which the SDK loads off-screen before opening that page's Apple Pay sheet.
Either way the customer sees only Apple's sheet. The prop is read only by the surfaces that need
it (a provider-hosted page does not use it), and choosing between them is the SDK's job — that is
the point of one component.

On iOS, both report `embeddable: false` (with the informational `surface: 'native-applepay'`): the
SDK presents the payment UI, so the component needs no visible area and a zero-size component is
enough. Both also
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

### Google Pay and the Android lifecycle

On Android, a `GOOGLE_PAY` order on `PROVIDER_HOSTED` with `COINBASE_PAYMENT_LINK` reports
`embeddable: false` and `requiresUserGesture: true`. Render the same component with no extra prop,
from the customer's tap on your Google Pay button; it needs no visible area. The provider's page
runs off-screen, its pay button is pressed once, and Google's sheet is all the customer sees.

The Android view mounts a surface with `embeddable: false` for the life of the app's current
Activity, not of the component's view. Leaving the screen (a pushed screen, another tab, a modal)
neither ends nor restarts the payment, and its callbacks keep arriving. The payment ends when you
unmount the component, or when that Activity is destroyed, including by a configuration change it
does not handle itself; the React Native template's `android:configChanges` already covers
rotation, screen size and dark mode. If no Activity is on screen, the component reports
`MOUNT_FAILED`. Embedded card widgets still render into the component's view.

Replacing the order tears down the old mount, discards its late callbacks and mounts the new order.
Passing an equal order again does not restart the payment, and an order that failed to mount is
not retried until a different one arrives.

Google Pay runs on your own provider account, and your app needs its own approval in the
[Google Pay & Wallet Console](https://pay.google.com/business/console) and a Google Play listing
before it works in production. It needs a physical phone. See
[meldsdk-android's Google Pay section](https://github.com/meldeng/meldsdk-android#google-pay) for
the device requirements, TEST-environment orders and troubleshooting.

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

### Terminal contract

On iOS and Android, from mount until you unmount the component, the SDK delivers **exactly one**
terminal callback, and nothing after it: no `onStatusChange` and no `onReady`.

- `onPaymentSubmitted`: the payment was submitted. Settlement arrives by webhook.
- `onCancel`: nothing will settle for this order.
- `onError` with `recoverable: false`: `attemptMayExist(e.code)` says whether a payment attempt
  may exist.

`recoverable: true` comes only from visible embedded card widgets, and is not terminal. Unmounting
before a terminal callback delivers none.

### Error codes

`MeldErrorCode` names the codes, and `attemptMayExist(code)` says whether a payment attempt may
exist after a terminal error. It returns the same as `attemptMayExist` in MeldSDK iOS 0.10.0 and
io.meld:meldsdk 0.8.0 for every code except the four
[this wrapper reports itself](#codes-only-this-wrapper-reports). No native SDK emits those four; the
native functions answer true for them, as for any code they do not know, and this one answers
false, because nothing was mounted.

```tsx
import { MeldErrorCode, attemptMayExist } from '@meldcrypto/react-native-sdk';

onError={(e) => {
  if (e.recoverable) return;                                     // the card widget is still up
  if (attemptMayExist(e.code)) return followOrder(e.orderId);    // never pay this order again
  if (e.code === MeldErrorCode.PAYMENT_METHOD_UNAVAILABLE) return offerAnotherMethod(e.paymentMethodType);
  backToCheckout();
}}
```

`e.paymentMethodType` is the order's `paymentMethodType`, such as `APPLE_PAY` or `GOOGLE_PAY`, so
copy such as "Apple Pay isn't available" can name the method without branching on `e.code`. It is
absent when the order has none, and on errors from a native binary built before 0.10.0, such as
one running this JavaScript through an OTA update.

These seven codes, and their `attemptMayExist` values, are the same in every Meld SDK:

| `e.code` | `attemptMayExist` | Do |
|---|---|---|
| `PAYMENT_METHOD_UNAVAILABLE` | false | This device or customer cannot pay with the method. Offer another method |
| `PRESENTATION_FAILED` | false | Back to your CTA; the next tap creates a new order |
| `PAYMENT_REJECTED` | false (declined) | Ask the customer to choose another option |
| `ORDER_STATE_CHANGED` | false | Create a new order |
| `VERIFICATION_PENDING` | false | Tell the customer the provider is reviewing |
| `PAYMENT_OUTCOME_UNKNOWN` | **true** | Follow the order through your backend; never pay this order again |
| `PROVIDER_LOAD_FAILED` | **true** | The provider's page did not load. With `recoverable: true` the surface stays up and the customer may carry on; otherwise follow the order before offering a new one |

Android never emits `VERIFICATION_PENDING` today; it is listed so code shared across platforms reads
it the same way. `e.detail` carries the raw provider event and code (for example
`onramp_api.load_error:ERROR_CODE_GUEST_APPLE_PAY_NOT_SUPPORTED`), for logging only.

#### Codes only this wrapper reports

This wrapper reports these before or instead of a native mount. Nothing was mounted, so no attempt
exists: fix the input, or fall back.

| `e.code` | Reported when | `attemptMayExist` |
|---|---|---|
| `INVALID_ORDER` | The order JSON could not be parsed | false |
| `INVALID_APPLE_PAY_REQUEST` | iOS only: the `applePay` prop is malformed | false |
| `MOUNT_FAILED` | The native SDK refused the order, there was no window (iOS) or Activity (Android) to present it from, or an embedded surface stayed zero-size (iOS) | false |
| `UNSUPPORTED_NATIVE_PROTOCOL` | This app binary cannot present the order's declared protocol | false |

`MOUNT_FAILED` is never a card widget's own `mount_failed`. When the Uphold or Banxa card widget's
provider SDK does not load (`sdk_unavailable`), iOS and Android report `PROVIDER_LOAD_FAILED`
(`attemptMayExist` true). When mounting the widget throws before it shows (`mount_failed`), they
report `PRESENTATION_FAILED` (false). `e.detail` names the widget's own code.

#### Codes from one platform or provider

Each of these may follow a payment: follow the order through your backend and never pay it again.

| `e.code` | Reported by | `attemptMayExist` |
|---|---|---|
| `PAYMENT_STATE_UNAVAILABLE` | iOS: Mercuryo Apple Pay could not read the order's payment state before the sheet | true |
| `PAYMENT_CONTINUATION_UNAVAILABLE` | iOS: Mercuryo Apple Pay could not continue the existing order on this device | true |
| `INVALID_VERIFICATION` | iOS: the provider's verification response cannot be presented | true |
| `VERIFICATION_WINDOW_EXPIRED` | iOS: the verification window closed | true |
| `VERIFICATION_UNAVAILABLE` | iOS: the device could not record that verification was opened | true |
| `WAIT_FOR_PAYMENT` | iOS: verification was already opened for this order | true |
| `PAYMENT_NOT_ACCEPTED` | iOS: the legacy Mercuryo Apple Pay endpoint did not accept the payment | true |
| `authorize_session_failed`, `authorize_session_invalid` | iOS and Android: the Uphold card widget could not start its authorization step | true |
| A card widget's own code, such as `error`, or a provider's terminal status, such as Mercuryo's `failed` | iOS and Android: the Mercuryo, Uphold and Banxa card widgets, and on iOS the legacy Mercuryo Apple Pay endpoint | true |

Any other code, including one this version does not know, also has `attemptMayExist` true.

Before 0.10.0, iOS reported `APPLE_PAY_UNAVAILABLE` where it now reports
`PAYMENT_METHOD_UNAVAILABLE`. 0.10.0 removes it: `MeldErrorCode.APPLE_PAY_UNAVAILABLE` is gone, and
`attemptMayExist` treats the old code like any other code this version does not know. iOS also
reported `NAVIGATION_FAILED` when a provider page failed after it had started loading; it now
reports `PROVIDER_LOAD_FAILED` with `recoverable: false`. The Uphold card widget, and the Banxa one
on Android, reported `sdk_unavailable` and `mount_failed` as their own codes.

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
