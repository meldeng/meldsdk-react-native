import Foundation

/// The readiness answer JavaScript receives, built from plain values so it can be tested without React Native.
enum MeldReadinessEvent {
    static let ready: [String: Any] = ["status": "ready"]

    static func unavailable(code: String, reason: String) -> [String: Any] {
        ["status": "unavailable", "code": code, "reason": reason]
    }

    static func unknown(reason: String) -> [String: Any] {
        ["status": "unknown", "reason": reason]
    }
}
