import Foundation

/// Main-thread ownership for one native mount. Values are compared in memory, never logged/stored.
final class MeldMountLifecycle<Handle> {
    private let unmount: (Handle) -> Void
    private var handle: Handle?
    private var signature: Data?
    private var generation = UUID()

    init(unmount: @escaping (Handle) -> Void) { self.unmount = unmount }

    func isCurrent(_ token: UUID) -> Bool { signature != nil && generation == token }
    var hasAttemptedMount: Bool { signature != nil }

    func mount(signature next: Data, ready: Bool = true, make: (UUID) throws -> Handle, failed: (UUID, Error) -> Void) {
        guard signature != next else { return }
        detach()
        guard ready else { return }
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

    func detach() {
        generation = UUID()
        signature = nil
        let previous = handle
        handle = nil
        if let previous { unmount(previous) }
    }

    deinit { if let handle { unmount(handle) } }
}
