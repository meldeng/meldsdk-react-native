import React
import MeldSDK

/// The imperative Meld API (`configure` / `capabilities`) exposed to JS as
/// `NativeModules.MeldModule`. Kept separate from the view manager so it's an unambiguous native
/// module on both the Old Architecture and the New-Architecture interop layer (a view manager's
/// exported methods aren't reliably reachable as a module under Fabric). Mirrors the Android
/// `MeldWidgetModule` (also named "MeldModule").
@objc(MeldModule)
final class MeldModule: NSObject {
    @objc static func requiresMainQueueSetup() -> Bool { true }

    @objc func configure(_ environment: NSString) {
        // Parsed by raw value rather than a "production or else sandbox" test: silently collapsing
        // an unrecognised environment to sandbox is how a QA build ends up posting to the sandbox
        // API and never finding its order.
        let parsed = MeldEnvironment(rawValue: environment as String) ?? .sandbox
        Meld.configure(environment: parsed)
    }

    /// Whether this device and user can pay with Apple Pay right now — a provisioned card and no
    /// restriction. Check before offering the option; `canMakePayments()` alone would be true on a
    /// device with an empty Wallet.
    @objc func canPresentApplePay(_ resolve: @escaping RCTPromiseResolveBlock,
                                  rejecter reject: @escaping RCTPromiseRejectBlock) {
        resolve(Meld.canPresentApplePay())
    }

    /// Inspect an order before rendering the widget — bridges to `Meld.capabilities(for:)`.
    @objc func capabilities(_ order: NSDictionary,
                            resolver resolve: @escaping RCTPromiseResolveBlock,
                            rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let data = try? JSONSerialization.data(withJSONObject: order),
              let parsed = try? MeldOrder.from(jsonData: data) else {
            reject("invalid_order", "Could not parse the order JSON", nil)
            return
        }
        let caps = Meld.capabilities(for: parsed)
        resolve([
            "embeddable": caps.embeddable,
            "surface": caps.surface,
            "requiresUserGesture": caps.requiresUserGesture,
        ])
    }
}
