import Foundation
import XCTest
@testable import MeldBridgeSupport

private func attached<T>(_ state: MeldMountLifecycle<T>) -> MeldMountLifecycle<T> {
    state.attached = true
    return state
}

final class MeldBridgeSupportTests: XCTestCase {
    func testModernRequestNeedsOnlyAmountAndCurrency() throws {
        let input = try MeldApplePayInput(["amount": "20.25", "currencyCode": "USD"])
        XCTAssertEqual(input.amount, Decimal(string: "20.25"))
        XCTAssertEqual(input.walletAddress, "")
        XCTAssertEqual(input.clientIpAddress, "")
        XCTAssertEqual(input.summaryItemLabel, "Crypto purchase")
        XCTAssertEqual(input.description, "MeldApplePayInput[REDACTED]")
    }

    func testLegacyFieldsArePreservedWithoutLogging() throws {
        let input = try MeldApplePayInput(["amount": "10.00", "currencyCode": "EUR",
            "walletAddress": "synthetic-wallet", "clientIpAddress": "192.0.2.1", "email": "synthetic@example.test",
            "summaryItemLabel": "Test purchase"])
        XCTAssertEqual(input.walletAddress, "synthetic-wallet")
        XCTAssertEqual(input.clientIpAddress, "192.0.2.1")
        XCTAssertEqual(input.email, "synthetic@example.test")
        XCTAssertFalse(input.description.contains("synthetic"))
    }

    func testExplicitMalformedValuesCannotBecomeAnAbsentRequest() {
        for amount: Any in [true, 10, "", "0", "-1", "NaN", "1e2", "10junk", "1,50", "1\n", String(repeating: "9", count: 40), NSNull()] {
            XCTAssertThrowsError(try MeldApplePayInput(["amount": amount, "currencyCode": "USD"]))
        }
        for currency: Any in ["usd", "US", "USD\n", 123, NSNull()] {
            XCTAssertThrowsError(try MeldApplePayInput(["amount": "10", "currencyCode": currency]))
        }
        for field in ["email", "walletAddress", "clientIpAddress", "summaryItemLabel"] {
            for value: Any in [123, NSNull(), "line\nbreak", String(repeating: "x", count: 256)] {
                XCTAssertThrowsError(try MeldApplePayInput(["amount": "10", "currencyCode": "USD", field: value]))
            }
        }
        XCTAssertThrowsError(try MeldApplePayInput(["amount": "10", "currencyCode": "USD", "summaryItemLabel": ""]))
    }

    func testPropBatchesDoNotRemountAnUnchangedOrder() {
        var mounted = 0, unmounted: [Int] = []
        let state = attached(MeldMountLifecycle<Int> { unmounted.append($0) })
        for _ in 0..<3 {
            state.mount(signature: Data("order".utf8), make: { _ in mounted += 1; return mounted }, failed: { _, _ in XCTFail() })
        }
        XCTAssertEqual(mounted, 1)
        XCTAssertTrue(unmounted.isEmpty)
        state.detach()
        XCTAssertEqual(unmounted, [1])
    }

    func testReplacementInvalidatesOldEventsBeforeUnmountAndMountsTheNewOrder() {
        var tokens: [UUID] = [], oldWasCurrentDuringUnmount = true
        var state: MeldMountLifecycle<Int>!
        state = attached(MeldMountLifecycle { _ in oldWasCurrentDuringUnmount = state.isCurrent(tokens[0]) })
        state.mount(signature: Data("first".utf8), make: { tokens.append($0); return 1 }, failed: { _, _ in XCTFail() })
        state.mount(signature: Data("second".utf8), make: { tokens.append($0); return 2 }, failed: { _, _ in XCTFail() })
        XCTAssertFalse(oldWasCurrentDuringUnmount)
        XCTAssertFalse(state.isCurrent(tokens[0]))
        XCTAssertTrue(state.isCurrent(tokens[1]))
        state.detach()
    }

    func testSynchronousDetachCannotRetainTheJustCreatedHandle() {
        var unmounted: [Int] = [], token: UUID?
        let state = attached(MeldMountLifecycle<Int> { unmounted.append($0) })
        state.mount(signature: Data("order".utf8), make: { generation in
            token = generation; state.detach(); return 1
        }, failed: { _, _ in XCTFail() })
        XCTAssertEqual(unmounted, [1])
        XCTAssertFalse(state.isCurrent(token!))
        XCTAssertFalse(state.hasAttemptedMount)
    }

    func testSynchronousReplacementCannotOverwriteTheNewHandle() {
        var unmounted: [Int] = []
        let state = attached(MeldMountLifecycle<Int> { unmounted.append($0) })
        state.mount(signature: Data("first".utf8), make: { _ in
            state.mount(signature: Data("second".utf8), make: { _ in 2 }, failed: { _, _ in XCTFail() })
            return 1
        }, failed: { _, _ in XCTFail() })
        XCTAssertEqual(unmounted, [1])
        state.detach()
        XCTAssertEqual(unmounted, [1, 2])
    }

    func testFailedMountIsNotRetriedByUnrelatedPropOrLayoutBatches() {
        var attempts = 0, failures = 0
        let state = attached(MeldMountLifecycle<Int> { _ in XCTFail() })
        for _ in 0..<3 {
            state.mount(signature: Data("order".utf8), make: { _ in
                attempts += 1; throw MeldBridgeInputError.invalidApplePayRequest
            }, failed: { _, _ in failures += 1 })
        }
        XCTAssertEqual(attempts, 1)
        XCTAssertEqual(failures, 1)
    }

    func testEmbeddedReplacementClosesOldOrderWhileWaitingForLayout() {
        var unmounted: [Int] = []
        let state = attached(MeldMountLifecycle<Int> { unmounted.append($0) })
        state.mount(signature: Data("old".utf8), make: { _ in 1 }, failed: { _, _ in XCTFail() })
        state.mount(signature: Data("new".utf8), ready: false, make: { _ in XCTFail(); return 2 }, failed: { _, _ in XCTFail() })
        XCTAssertEqual(unmounted, [1])
        XCTAssertFalse(state.hasAttemptedMount)
        state.mount(signature: Data("new".utf8), ready: true, make: { _ in 2 }, failed: { _, _ in XCTFail() })
        XCTAssertTrue(state.hasAttemptedMount)
        state.detach()
        XCTAssertEqual(unmounted, [1, 2])
    }

    func testLeavingAndReenteringTheWindowKeepsOneMountAndItsCallbacks() {
        var mounted = 0, unmounted: [Int] = [], token: UUID?
        let state = attached(MeldMountLifecycle<Int> { unmounted.append($0) })
        let order = Data("order".utf8)
        state.mount(signature: order, make: { mounted += 1; token = $0; return mounted }, failed: { _, _ in XCTFail() })

        state.attached = false
        state.mount(signature: order, make: { _ in XCTFail(); return 0 }, failed: { _, _ in XCTFail() })
        XCTAssertTrue(state.isCurrent(token!), "a terminal delivered while away must still reach JS")
        state.attached = true
        state.mount(signature: order, make: { _ in XCTFail(); return 0 }, failed: { _, _ in XCTFail() })

        XCTAssertEqual(mounted, 1)
        XCTAssertTrue(unmounted.isEmpty)
        XCTAssertTrue(state.isCurrent(token!))
        state.detach()
        XCTAssertEqual(unmounted, [1])
    }

    func testNothingMountsBeforeAttachmentAndReplacementWhileAwayClosesTheOldMount() {
        var unmounted: [Int] = [], tokens: [UUID] = []
        let state = MeldMountLifecycle<Int> { unmounted.append($0) }
        state.mount(signature: Data("first".utf8), make: { _ in XCTFail(); return 0 }, failed: { _, _ in XCTFail() })
        XCTAssertFalse(state.hasAttemptedMount)
        state.attached = true
        state.mount(signature: Data("first".utf8), make: { tokens.append($0); return 1 }, failed: { _, _ in XCTFail() })

        state.attached = false
        state.mount(signature: Data("second".utf8), make: { _ in XCTFail(); return 0 }, failed: { _, _ in XCTFail() })
        XCTAssertEqual(unmounted, [1])
        XCTAssertFalse(state.isCurrent(tokens[0]))
        state.attached = true
        state.mount(signature: Data("second".utf8), make: { tokens.append($0); return 2 }, failed: { _, _ in XCTFail() })
        XCTAssertTrue(state.isCurrent(tokens[1]))
        state.detach()
        XCTAssertEqual(unmounted, [1, 2])
    }

    func testAHostThatStaysZeroSizeReportsOnceAndNeverMountsThoseInputs() {
        var failures: [UUID] = []
        let state = attached(MeldMountLifecycle<Int> { _ in XCTFail() })
        let order = Data("order".utf8)
        state.mount(signature: order, ready: false, make: { _ in XCTFail(); return 0 }, failed: { _, _ in XCTFail() })
        let token = state.waitToken!
        state.mount(signature: order, ready: false, make: { _ in XCTFail(); return 0 }, failed: { _, _ in XCTFail() })
        XCTAssertEqual(state.waitToken, token, "repeated layout passes must not restart the grace period")

        state.abandonWaiting(token) { failures.append($0) }
        state.abandonWaiting(token) { failures.append($0) }
        XCTAssertEqual(failures, [token])
        XCTAssertTrue(state.isCurrent(token))
        XCTAssertNil(state.waitToken)
        state.mount(signature: order, ready: true, make: { _ in XCTFail(); return 0 }, failed: { _, _ in XCTFail() })
    }

    func testLayoutArrivingWithinTheGracePeriodMountsAndDisarmsTheDeadline() {
        var unmounted: [Int] = []
        let state = attached(MeldMountLifecycle<Int> { unmounted.append($0) })
        let order = Data("order".utf8)
        state.mount(signature: order, ready: false, make: { _ in XCTFail(); return 0 }, failed: { _, _ in XCTFail() })
        let deadline = state.waitToken!
        state.mount(signature: order, ready: true, make: { _ in 1 }, failed: { _, _ in XCTFail() })
        state.abandonWaiting(deadline) { _ in XCTFail("a stale deadline must not fail a live mount") }
        XCTAssertTrue(state.hasAttemptedMount)
        state.detach()
        XCTAssertEqual(unmounted, [1])
    }

    func testApplePayInputsCountOnlyForApplePayOrders() throws {
        let card: NSDictionary = ["id": "synthetic", "paymentMethodType": "CREDIT_DEBIT_CARD"]
        let wallet: NSDictionary = ["id": "synthetic", "paymentMethodType": "APPLE_PAY"]
        let first: NSDictionary = ["amount": "10.00", "currencyCode": "USD", "summaryItemLabel": "Buy"]
        let rebuilt: NSDictionary = ["amount": "10", "currencyCode": "USD", "summaryItemLabel": "Kaufen"]

        XCTAssertEqual(try MeldMountSignature.make(order: card, applePay: first), try MeldMountSignature.make(order: card, applePay: rebuilt))
        XCTAssertEqual(try MeldMountSignature.make(order: card, applePay: nil), try MeldMountSignature.make(order: card, applePay: first))
        XCTAssertNotEqual(try MeldMountSignature.make(order: wallet, applePay: first), try MeldMountSignature.make(order: wallet, applePay: rebuilt))
        XCTAssertNotEqual(try MeldMountSignature.make(order: wallet, applePay: nil), try MeldMountSignature.make(order: wallet, applePay: first))

        var mounted = 0
        let state = attached(MeldMountLifecycle<Int> { _ in })
        for applePay in [first, rebuilt, nil] {
            state.mount(signature: try MeldMountSignature.make(order: card, applePay: applePay),
                        make: { _ in mounted += 1; return mounted }, failed: { _, _ in XCTFail() })
        }
        XCTAssertEqual(mounted, 1, "rebuilding applePay must not restart a card form")
    }
}
