import Foundation

enum MeldBridgeInputError: Error { case invalidApplePayRequest }

/// Bridge validation only. The native adapter enforces the order's amount, currency and legacy data.
struct MeldApplePayInput: CustomStringConvertible {
    let amount: Decimal
    let currencyCode: String
    let walletAddress: String
    let clientIpAddress: String
    let email: String?
    let summaryItemLabel: String
    var description: String { "MeldApplePayInput[REDACTED]" }

    init(_ value: NSDictionary) throws {
        guard let amount = value["amount"] as? String, amount.utf8.count <= 64,
              amount.range(of: "\\A[0-9]{1,18}(?:\\.[0-9]{1,18})?\\z", options: .regularExpression) != nil,
              let decimal = Decimal(string: amount, locale: Locale(identifier: "en_US_POSIX")), decimal > 0,
              let currency = value["currencyCode"] as? String,
              currency.range(of: "\\A[A-Z]{3}\\z", options: .regularExpression) != nil
        else { throw MeldBridgeInputError.invalidApplePayRequest }
        self.amount = decimal; currencyCode = currency
        walletAddress = try Self.optionalText(value, "walletAddress", limit: 255) ?? ""
        clientIpAddress = try Self.optionalText(value, "clientIpAddress", limit: 255) ?? ""
        email = try Self.optionalText(value, "email", limit: 254)
        summaryItemLabel = try Self.optionalText(value, "summaryItemLabel", limit: 128) ?? "Crypto purchase"
        guard !summaryItemLabel.isEmpty else { throw MeldBridgeInputError.invalidApplePayRequest }
    }

    private static func optionalText(_ value: NSDictionary, _ key: String, limit: Int) throws -> String? {
        guard let raw = value[key] else { return nil }
        guard let text = raw as? String, text.utf8.count <= limit,
              !text.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains)
        else { throw MeldBridgeInputError.invalidApplePayRequest }
        return text
    }
}
