import Foundation

/// The `onError` payload JavaScript receives, built from plain values so it can be tested without React Native.
enum MeldErrorEvent {
    static func payload(orderId: String?, code: String, message: String, detail: String?, recoverable: Bool,
                        paymentMethodType: String?) -> [String: Any] {
        var payload: [String: Any] = [
            "orderId": orderId ?? "",
            "code": code,
            "message": message,
            "detail": detail ?? "",
            "recoverable": recoverable,
        ]
        if let paymentMethodType, !paymentMethodType.isEmpty { payload["paymentMethodType"] = paymentMethodType }
        return payload
    }

    /// The order prop's `paymentMethodType`, for the errors the bridge reports before or instead of a mount.
    static func paymentMethodType(of order: NSDictionary?) -> String? {
        guard let value = order?["paymentMethodType"] as? String, !value.isEmpty else { return nil }
        return value
    }
}
