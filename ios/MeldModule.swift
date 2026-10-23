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
    @objc var methodQueue: DispatchQueue { .main }
    @objc func constantsToExport() -> [String: Any] { ["headlessProtocolVersion": 1] }

    @objc func configure(_ environment: NSString) {
        // Parsed by raw value rather than a "production or else sandbox" test: silently collapsing
        // an unrecognised environment to sandbox is how a QA build ends up posting to the sandbox
        // API and never finding its order.
        let parsed = MeldEnvironment(rawValue: environment as String) ?? .sandbox
        Meld.configure(environment: parsed)
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

    /// Advisory descriptor support from the installed adapter registry; no order or network request.
    @objc func presentationCapabilities(_ paymentMethodType: NSString,
                                        presentation: NSDictionary,
                                        resolver resolve: @escaping RCTPromiseResolveBlock,
                                        rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let json = presentation as? [String: Any],
              let descriptor = MeldHeadlessPresentation(json: json) else {
            resolve(["embeddable": false, "surface": "unsupported", "requiresUserGesture": false])
            return
        }
        let caps = Meld.capabilities(for: descriptor, paymentMethodType: paymentMethodType as String)
        resolve([
            "embeddable": caps.embeddable,
            "surface": caps.surface,
            "requiresUserGesture": caps.requiresUserGesture,
        ])
    }

    /// Device readiness for a payment method before any quote, from the native SDK; no order or network request.
    @objc func paymentMethodReadiness(_ paymentMethodType: NSString,
                                      resolver resolve: @escaping RCTPromiseResolveBlock,
                                      rejecter reject: @escaping RCTPromiseRejectBlock) {
        Meld.paymentMethodReadiness(paymentMethodType as String) { resolve(Self.payload($0)) }
    }

    /// Device readiness for a quote row's method, from the native SDK; no order or network request.
    @objc func presentationReadiness(_ paymentMethodType: NSString,
                                     presentation: NSDictionary,
                                     resolver resolve: @escaping RCTPromiseResolveBlock,
                                     rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let json = presentation as? [String: Any],
              let descriptor = MeldHeadlessPresentation(json: json) else {
            resolve(MeldReadinessEvent.unavailable(code: MeldErrorCode.paymentMethodUnavailable,
                                                   reason: "The headlessPresentation is malformed."))
            return
        }
        Meld.presentationReadiness(descriptor, paymentMethodType: paymentMethodType as String) { resolve(Self.payload($0)) }
    }

    private static func payload(_ readiness: MeldReadiness) -> [String: Any] {
        switch readiness {
        case .ready:
            return MeldReadinessEvent.ready
        case let .unavailable(code, reason):
            return MeldReadinessEvent.unavailable(code: code, reason: reason)
        case let .unknown(reason):
            return MeldReadinessEvent.unknown(reason: reason)
        }
    }
}
