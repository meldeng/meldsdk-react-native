import React
import MeldSDK

/// Native Apple Pay (Mercuryo NAP) exposed to JS as `NativeModules.MeldApplePay`.
///
/// Unlike the card widget (mounted into a view via `MeldWidget`), Apple Pay is a modal system
/// sheet — there's no view to host — so it's an imperative module: `presentApplePay(order, request)`
/// resolves on a successful/pending payment and rejects on cancel/failure/error. The host backend
/// mints the order (`POST /crypto/order/headless`, `paymentMethodType=APPLE_PAY`); the SDK builds the
/// `PKPaymentRequest`, presents the sheet, and drives `/crypto/session/mercuryo/apple-pay/process`.
@objc(MeldApplePay)
final class MeldApplePay: NSObject {
    @objc static func requiresMainQueueSetup() -> Bool { true }

    private var handle: MeldWidgetHandle?
    private var settled = false

    @objc func isAvailable(_ resolve: @escaping RCTPromiseResolveBlock,
                           rejecter reject: @escaping RCTPromiseRejectBlock) {
        resolve(Meld.canPresentApplePay())
    }

    @objc func presentApplePay(_ order: NSDictionary,
                               request: NSDictionary,
                               resolver resolve: @escaping RCTPromiseResolveBlock,
                               rejecter reject: @escaping RCTPromiseRejectBlock) {
        // The sheet is presented on the main thread.
        DispatchQueue.main.async {
            self.settled = false
            let resolveOnce: ([String: Any]) -> Void = { value in
                guard !self.settled else { return }
                self.settled = true
                resolve(value)
            }
            let rejectOnce: (String, String) -> Void = { code, message in
                guard !self.settled else { return }
                self.settled = true
                reject(code, message, nil)
            }

            guard let data = try? JSONSerialization.data(withJSONObject: order),
                  let parsed = try? MeldOrder.from(jsonData: data) else {
                return rejectOnce("invalid_order", "Could not parse the order JSON")
            }
            guard Meld.capabilities(for: parsed).surface == "native-applepay" else {
                return rejectOnce("invalid_order", "Order is not a native Apple Pay order")
            }
            guard Meld.canPresentApplePay() else {
                return rejectOnce("unavailable", "Apple Pay is not available on this device or for this user")
            }
            guard let amountStr = request["amount"] as? String, let amount = Decimal(string: amountStr),
                  let currencyCode = request["currencyCode"] as? String,
                  let walletAddress = request["walletAddress"] as? String,
                  let clientIpAddress = request["clientIpAddress"] as? String else {
                return rejectOnce("bad_request", "amount, currencyCode, walletAddress and clientIpAddress are required")
            }

            let req = MeldApplePayRequest(
                amount: amount,
                currencyCode: currencyCode,
                walletAddress: walletAddress,
                clientIpAddress: clientIpAddress,
                email: request["email"] as? String,
                summaryItemLabel: (request["summaryItemLabel"] as? String) ?? "Crypto purchase"
            )

            do {
                self.handle = try Meld.mount(parsed, applePay: req, handlers: MeldEventHandlers(
                    onReady: { _ in },
                    onPaymentSubmitted: { _ in },
                    onStatusChange: { event in
                        if event.status == .completed || event.status == .pending {
                            resolveOnce(["status": "success"])
                        } else if event.status == .failed {
                            rejectOnce("failed", "Payment failed")
                        }
                    },
                    onCancel: { _ in rejectOnce("cancelled", "User cancelled Apple Pay") },
                    onError: { error in rejectOnce("error", error.message) }
                ))
            } catch {
                rejectOnce("error", error.localizedDescription)
            }
        }
    }
}
