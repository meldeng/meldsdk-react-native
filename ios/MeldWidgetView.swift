import UIKit
import React
import MeldSDK

/// A UIView that hosts the Meld widget and forwards the SDK's events as React Native event blocks.
/// Thin pass-through — all SDK logic stays in MeldSDK.
final class MeldWidgetView: UIView {
    private var handle: MeldWidgetHandle?

    // Wired up by React Native from the matching JS props.
    @objc var onReady: RCTDirectEventBlock?
    @objc var onPaymentSubmitted: RCTDirectEventBlock?
    @objc var onStatusChange: RCTDirectEventBlock?
    @objc var onCancel: RCTDirectEventBlock?
    @objc var onError: RCTDirectEventBlock?

    // The order JSON from JS.
    @objc var order: NSDictionary?

    // Inputs a native Apple Pay sheet needs beyond what the order carries. Only read for an order
    // whose presentation is the encrypted-token shape; ignored for every other surface, which is
    // why one component can host all of them.
    @objc var applePay: NSDictionary?

    /// Mount once React Native has finished applying a batch of props, NOT from an individual
    /// property observer.
    ///
    /// Prop application order within a batch is not guaranteed, so mounting from `order.didSet`
    /// would race every other prop: an Apple Pay order could mount before `applePay` arrived and
    /// fail for a missing request, and an order applied before the handler blocks would dispatch
    /// its first events into nil. Waiting for the batch to settle removes both.
    override func didSetProps(_ changedProps: [String]) {
        super.didSetProps(changedProps)
        mountIfNeeded()
    }

    private func mountIfNeeded() {
        guard handle == nil, let order else { return }

        // Parse failures used to be swallowed by `try?`, leaving a blank view with no signal to
        // JS. Surface them through onError so the integrator can react.
        let parsed: MeldOrder
        do {
            let data = try JSONSerialization.data(withJSONObject: order)
            parsed = try MeldOrder.from(jsonData: data)
        } catch {
            emitError(code: "INVALID_ORDER", message: "Could not parse the order JSON: \(error.localizedDescription)")
            return
        }

        do {
            // [weak self]: WebKit retains the script handler (and thus the session) for the
            // WebView's lifetime; capturing self strongly here would form a retain cycle that
            // only breaks at removeFromSuperview -> unmount.
            handle = try Meld.mount(parsed, into: self, applePay: applePayRequest(), handlers: MeldEventHandlers(
                onReady: { [weak self] id in self?.onReady?(["orderId": id ?? ""]) },
                onPaymentSubmitted: { [weak self] id in self?.onPaymentSubmitted?(["orderId": id ?? ""]) },
                onStatusChange: { [weak self] e in
                    var payload: [String: Any] = [
                        "orderId": e.orderId ?? "",
                        "status": e.status.rawValue,
                        "providerStatus": e.providerStatus ?? "",
                    ]
                    // Forward the raw provider payload when it's JSON-serializable, for parity
                    // with the native struct (logging/debugging on the JS side).
                    if let raw = e.raw, JSONSerialization.isValidJSONObject(raw) { payload["raw"] = raw }
                    self?.onStatusChange?(payload)
                },
                onCancel: { [weak self] id in self?.onCancel?(["orderId": id ?? ""]) },
                onError: { [weak self] e in self?.send(error: e) }
            ))
        } catch {
            // Mount failures (unsupported order, missing widget URL) also went silent under `try?`.
            emitError(code: "MOUNT_FAILED", message: error.localizedDescription)
        }
    }

    /// Builds the Apple Pay request from the JS prop, or nil when the prop is absent — which is the
    /// normal case for every non-Apple-Pay surface. Missing required fields yield nil rather than a
    /// half-built request, so the SDK reports the order-level problem instead of the sheet failing
    /// with a zero amount.
    private func applePayRequest() -> MeldApplePayRequest? {
        guard let applePay,
              // An explicit closure, not `Decimal.init(string:)` as a function reference: Decimal has
              // several generic `init` overloads and the reference is ambiguous.
              let amount = (applePay["amount"] as? String).flatMap({ Decimal(string: $0) }),
              let currencyCode = applePay["currencyCode"] as? String,
              let walletAddress = applePay["walletAddress"] as? String,
              let clientIpAddress = applePay["clientIpAddress"] as? String
        else { return nil }

        return MeldApplePayRequest(
            amount: amount,
            currencyCode: currencyCode,
            walletAddress: walletAddress,
            clientIpAddress: clientIpAddress,
            email: applePay["email"] as? String,
            summaryItemLabel: (applePay["summaryItemLabel"] as? String) ?? "Crypto purchase")
    }

    /// Forwards a native `MeldError` to JS, including `detail` for parity with the native struct.
    private func send(error e: MeldError) {
        onError?([
            "orderId": e.orderId ?? "",
            "code": e.code,
            "message": e.message,
            "detail": e.detail ?? "",
            "recoverable": e.recoverable,
        ])
    }

    private func emitError(code: String, message: String) {
        send(error: MeldError(orderId: nil, code: code, message: message, recoverable: false))
    }

    override func removeFromSuperview() {
        handle?.unmount() // teardown when RN removes the component
        handle = nil
        super.removeFromSuperview()
    }
}
