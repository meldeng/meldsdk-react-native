# MeldSDK — React Native example (iOS + Android)

A React Native app that runs the full flow on **both platforms**: live quote (**You pay** /
**You receive**) → editable wallet → **Buy** → mount the Mercuryo widget with `<MeldWidget>`, with
a status banner + event log and auto-close on a terminal outcome. Same flow and events as the
native [iOS](https://github.com/meldeng/meldsdk-ios/tree/main/Example),
[Android](https://github.com/meldeng/meldsdk-android/tree/main/example), and web examples.

This example links the wrapper from the repo root via `file:..` (see `metro.config.js`), so changes
to the wrapper are picked up directly.

> ⚠️ **POC:** the app creates the order by calling Meld **directly**, so the API key sits in the
> app. A real app creates the order on its backend — the SDK never sees the key.

## 1. Credentials

Secrets live in a gitignored `.env` (via `react-native-dotenv`):

```bash
cp .env.example .env      # then edit .env:
#   MELD_API_KEY=...       your sandbox/QA BASIC key
#   MELD_CUSTOMER_ID=...   a customer with APPROVED Sumsub KYC
#   MELD_API_HOST=api-qa.meld.io   (host only; default is api-sb.meld.io)
```

`.env` is read at **bundle time**, so after editing it restart Metro with a clean cache
(`npm start --reset-cache`).

## 2. Install

```bash
npm install            # installs RN deps + links the wrapper from the repo root
```

## 3. Run

**Start Metro in its own terminal and leave it running**, then build/launch from a second terminal.
(Starting Metro yourself is the reliable way to avoid the *"No script URL provided"* / *"Unable to
resolve module"* red screen — that just means the app launched with no packager.)

```bash
npm start              # terminal 1 — wait for "Dev server ready" on http://localhost:8081
```

### iOS

Needs Xcode + CocoaPods, and a sibling `meldsdk-ios` checkout (the local `MeldSDK` pod is resolved
from `../../../meldsdk-ios`). One-time pod install, then run:

```bash
cd ios && RCT_NEW_ARCH_ENABLED=0 USE_FRAMEWORKS=static pod install && cd ..
npm run ios            # terminal 2
```

Why the flags: build the **old architecture** (`RCT_NEW_ARCH_ENABLED=0`) and use **static
frameworks** (`USE_FRAMEWORKS=static`, since `MeldSDK` is a Swift pod).

### Android

Needs the Android SDK and the native `io.meld:meldsdk` artifact. For local dev, build it once from a
sibling [`meldsdk-android`](https://github.com/meldeng/meldsdk-android) checkout — it publishes to
your local Maven repo, which `android/build.gradle` reads via `mavenLocal()`:

```bash
# in the meldsdk-android checkout:
./gradlew publishReleasePublicationToMavenLocal
```

```bash
# back here, terminal 2:
npm run android
```

KYC uses the camera; the app requests the `CAMERA` permission on first launch.

## Notes

- **Settlement is the webhook, not a client event.** Treat `completed` / `onPaymentSubmitted` as
  UX hints; mark the order paid only on Meld's `TRANSACTION_STATUS_CHANGED` webhook to your backend.
- **Mercuryo prerequisites:** the customer needs APPROVED Sumsub KYC; KYC uses the camera (a real
  device, not a simulator/emulator); the order's `clientIpAddress` must match the device's egress IP.
- **New Architecture** (`RCT_NEW_ARCH_ENABLED=1`) is not supported yet on either platform.
