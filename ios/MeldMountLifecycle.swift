import Foundation

/// Main-thread ownership for one native mount. Values are compared in memory, never logged/stored.
final class MeldMountLifecycle<Handle> {
    private let unmount: (Handle) -> Void
    private var handle: Handle?
    private var signature: Data?
    private var waiting: Data?
    private var generation = UUID()

    /// Whether the host is in a window. Mounting waits for one. Leaving ends nothing: the component,
    /// not the window, owns the payment, so a pushed screen, tab switch or modal keeps its callbacks.
    var attached = false

    init(unmount: @escaping (Handle) -> Void) { self.unmount = unmount }

    func isCurrent(_ token: UUID) -> Bool { signature != nil && generation == token }
    var hasAttemptedMount: Bool { signature != nil }
    /// Identifies inputs held back until the host is attached and ready; nil when nothing waits.
    var waitToken: UUID? { waiting == nil ? nil : generation }

    func mount(signature next: Data, ready: Bool = true, make: (UUID) throws -> Handle, failed: (UUID, Error) -> Void) {
        guard signature != next else { return }
        let startable = attached && ready
        if waiting == next, !startable { return }
        detach()
        guard startable else { waiting = next; return }
        signature = next
        let token = generation
        do {
            let mounted = try make(token)
            // A synchronous event may detach or replace the view before make returns.
            if isCurrent(token) { handle = mounted }
            else { unmount(mounted) }
        } catch {
            if isCurrent(token) { failed(token, error) }
        }
    }

    /// Consumes inputs that never became ready, so a late layout cannot start them after the failure.
    func abandonWaiting(_ token: UUID, failed: (UUID) -> Void) {
        guard let pending = waiting, generation == token else { return }
        waiting = nil
        signature = pending
        failed(token)
    }

    func detach() {
        generation = UUID()
        signature = nil
        waiting = nil
        let previous = handle
        handle = nil
        if let previous { unmount(previous) }
    }

    deinit { if let handle { unmount(handle) } }
}

/// What one mount consumes. `applePay` counts only for an Apple Pay order: a card surface never reads
/// it, and a rebuilt prop must not restart a card form the customer is filling in.
enum MeldMountSignature {
    static func make(order: NSDictionary, applePay: NSDictionary?) throws -> Data {
        let consumed: Any = (order["paymentMethodType"] as? String) == "APPLE_PAY" ? applePay ?? NSNull() : NSNull()
        return try JSONSerialization.data(withJSONObject: ["order": order, "applePay": consumed], options: [.sortedKeys])
    }
}
