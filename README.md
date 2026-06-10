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

Until `MeldSDK` is on CocoaPods trunk, reference it from GitHub by tag in your `ios/Podfile`, then
install on the **old architecture** with **static frameworks** (`MeldSDK` is a Swift pod):

```ruby
pod 'MeldSDK', :git => 'https://github.com/meldeng/meldsdk-ios.git', :tag => '0.1.1'
```
```bash
cd ios && USE_FRAMEWORKS=static pod install
```

### Android

Add the repository that serves `io.meld:meldsdk` (the native Android SDK) to your app's
`android/build.gradle`. JitPack for releases; `mavenLocal()` if you build the SDK locally:

```gradle
allprojects {
    repositories {
        maven { url("https://www.jitpack.io") }
    }
}
```

`minSdk 24`+. The Android SDK declares the `INTERNET` and `CAMERA` permissions (camera is used for
in-widget KYC); they merge into your app automatically.

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

## Settlement — webhook, never the SDK

Neither `onPaymentSubmitted` nor `onStatusChange` with `status === 'completed'` is settlement —
both are client-side UX signals. Mark the order paid only when your backend receives Meld's
`TRANSACTION_STATUS_CHANGED` webhook. Show "processing", not "success", until then.

## Example app

A complete, runnable demo for **both platforms** is checked in at [`example/`](example/) (same flow
as the iOS, Android, and web demos). It links the wrapper from this repo via `file:..`, so changes
here are picked up directly.

```bash
cd example
npm install
cp .env.example .env   # add your creds (see example/README.md)
```

**iOS** (needs a sibling `meldsdk-ios` checkout for the local `MeldSDK` pod):

```bash
cd ios && USE_FRAMEWORKS=static pod install && cd ..
npm start            # terminal 1 — keep running
npm run ios          # terminal 2
```

**Android** (needs `io.meld:meldsdk` — build it locally from a sibling `meldsdk-android` checkout
once: `./gradlew publishReleasePublicationToMavenLocal`):

```bash
npm start            # terminal 1 — keep running
npm run android      # terminal 2
```

More detail in [example/README.md](example/README.md).

## License

Proprietary. See [LICENSE](LICENSE).
