import UIKit
import React
import MeldSDK

/// A UIView that hosts the Meld widget and forwards the SDK's events as React Native event blocks.
/// Thin pass-through — all SDK logic stays in MeldSDK.
final class MeldWidgetView: UIView {
    private let lifecycle = MeldMountLifecycle<MeldWidgetHandle>(unmount: { $0.unmount() })
    private var propsApplied = false

    // Wired up by React Native from the matching JS props.
    @objc var onReady: RCTDirectEventBlock?
    @objc var onPaymentSubmitted: RCTDirectEventBlock?
    @objc var onStatusChange: RCTDirectEventBlock?
    @objc var onCancel: RCTDirectEventBlock?
    @objc var onError: RCTDirectEventBlock?

    // The order JSON from JS.
    @objc var order: NSDictionary?

    // Inputs a native Apple Pay sheet needs beyond what the order carries. Supplied values are
    // validated here; protocol selection and order binding remain in MeldSDK.
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
        propsApplied = true
        mountIfNeeded()
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        if window == nil { lifecycle.detach() }
        else { mountIfNeeded() }
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        if !lifecycle.hasAttemptedMount { mountIfNeeded() }
    }

    private func mountIfNeeded() {
        guard propsApplied, window != nil else { return }
        guard let order else { lifecycle.detach(); return }

        // Parse failures used to be swallowed by `try?`, leaving a blank view with no signal to
        // JS. Surface them through onError so the integrator can react.
        let signature: Data
        let data: Data
        do {
            data = try JSONSerialization.data(withJSONObject: order)
            signature = try JSONSerialization.data(withJSONObject: ["order": order, "applePay": applePay.map { $0 as Any } ?? NSNull()], options: [.sortedKeys])
        } catch {
            lifecycle.detach()
            emitError(code: "INVALID_ORDER", message: "Could not parse the order JSON.")
            return
        }

        let parsed: MeldOrder
        do { parsed = try MeldOrder.from(jsonData: data) }
        catch {
            // Remember this failed attempt too: layout changes must not repeatedly report it.
            lifecycle.mount(signature: signature, make: { _ in throw error }, failed: { [weak self] generation, _ in
                self?.emit(generation) { $0.emitError(code: "INVALID_ORDER", message: "Could not parse the order JSON.") }
            })
            return
        }

        let ready = !Meld.capabilities(for: parsed).embeddable || (bounds.width > 0 && bounds.height > 0)
        lifecycle.mount(signature: signature, ready: ready, make: { generation in
            // [weak self]: WebKit retains the script handler (and thus the session) for the
            // WebView's lifetime; capturing self strongly here would form a retain cycle that
            // only breaks at removeFromSuperview -> unmount.
            return try Meld.mount(parsed, into: self, applePay: applePayRequest(), handlers: MeldEventHandlers(
                onReady: { [weak self] id in self?.emit(generation) { $0.onReady?(["orderId": id ?? ""]) } },
                onPaymentSubmitted: { [weak self] id in self?.emit(generation) { $0.onPaymentSubmitted?(["orderId": id ?? ""]) } },
                onStatusChange: { [weak self] e in
                    var payload: [String: Any] = [
                        "orderId": e.orderId ?? "",
                        "status": e.status.rawValue,
                        "providerStatus": e.providerStatus ?? "",
                    ]
                    // Forward the raw provider payload when it's JSON-serializable, for parity
                    // with the native struct (logging/debugging on the JS side).
                    if let raw = e.raw, JSONSerialization.isValidJSONObject(raw) { payload["raw"] = raw }
                    self?.emit(generation) { $0.onStatusChange?(payload) }
                },
                onCancel: { [weak self] id in self?.emit(generation) { $0.onCancel?(["orderId": id ?? ""]) } },
                onError: { [weak self] e in self?.emit(generation) { $0.send(error: e) } }
            ))
        }, failed: { [weak self] generation, error in
            // Mount failures (unsupported order, missing widget URL) also went silent under `try?`.
            self?.emit(generation) { view in
                if error is MeldBridgeInputError {
                    view.emitError(code: "INVALID_APPLE_PAY_REQUEST", message: "Could not validate the Apple Pay request.")
                } else {
                    view.emitError(code: "MOUNT_FAILED", message: "This order could not be mounted. Check its capabilities and configuration.")
                }
            }
        })
    }

    /// Builds the Apple Pay request from the JS prop, or nil when the prop is absent — which is the
    /// normal case for every non-Apple-Pay surface. An explicitly malformed prop fails instead of
    /// being treated as absent. Legacy wallet/IP requirements are enforced by the selected adapter.
    private func applePayRequest() throws -> MeldApplePayRequest? {
        guard let applePay else { return nil }
        let input = try MeldApplePayInput(applePay)
        return MeldApplePayRequest(
            amount: input.amount, currencyCode: input.currencyCode, walletAddress: input.walletAddress,
            clientIpAddress: input.clientIpAddress, email: input.email, summaryItemLabel: input.summaryItemLabel)
    }

    private func emit(_ generation: UUID, _ event: (MeldWidgetView) -> Void) {
        guard window != nil, lifecycle.isCurrent(generation) else { return }
        event(self)
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
        lifecycle.detach() // teardown when RN removes the component, including late callbacks
        super.removeFromSuperview()
    }
}
