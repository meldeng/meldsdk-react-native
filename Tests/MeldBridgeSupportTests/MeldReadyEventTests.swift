import Foundation
import XCTest
@testable import MeldBridgeSupport

private struct TestField: ReadyFieldValues {
    var key: String, label: String? = nil, fieldType: String? = nil, jsonSchema: String? = nil, allowedValues: [String]? = nil
}

private struct TestStep: ReadyStepValues {
    var stepId = "*:MELD_KYC:MELD_KYC", kind = "SUBMIT", type = "MELD_KYC", code = "MELD_KYC"
    var serviceProviders = ["BANXA"]
    var level: String? = nil, url: String? = nil, expiresAt: Date? = nil
    var fields: [TestField]? = nil
    var reason: String? = nil
}

private struct TestRequirement: ReadyRequirementValues {
    var type: String, code: String, status: String, reason: String?, errorCodes: [String]? = nil
}
private struct TestProvider: ReadyProviderValues {
    var serviceProvider: String, status: String, eligible: Bool?, open: [TestRequirement]
}
private struct TestContinuation: ReadyContinuationValues { var serviceProvider: String, code: String, nextStep: String? }
private enum TestKind: String { case http, transport, `protocol` }
private struct TestFailure: ReadyErrorValues { var kind: TestKind, status: Int?, code: String? }
private enum TestStatus: String { case ready = "READY", actionRequired = "ACTION_REQUIRED", blocked = "BLOCKED", failed = "FAILED" }
private struct RunResult: ReadyResultValues {
    var status: TestStatus, providers: [TestProvider] = [], pending: [TestStep]? = nil, continuation: [TestContinuation] = []
    var error: TestFailure? = nil
}
private struct TestFieldError: ReadyFieldErrorValues { var key: String, reason: String }
private struct TestCollect: ReadyCollectValues {
    var stepId = "*:CUSTOMER_DETAILS:CUSTOMER_NAME", type = "CUSTOMER_DETAILS", code = "CUSTOMER_NAME"
    var serviceProviders = ["UPHOLD"]
    var fields = [TestField(key: "name.firstName", label: "First name"), TestField(key: "name.lastName")]
    var reason: String? = nil
    var fieldErrors: [TestFieldError]? = nil
}
private struct TestAgreement: ReadyAgreementValues { var stepId: String, serviceProvider: String, code: String, url: URL? }
private struct TestPresentUrl: ReadyPresentUrlValues { var stepId: String, url: URL, expiresAt: Date? }
private enum TestState: String { case waiting = "WAITING" }
private struct TestProgress: ReadyProgressValues { var state: TestState, snapshot: [String: Any]? }

private func json(_ value: Any) -> NSObject {
    // Round trip through JSON so Swift values compare as JavaScript would receive them.
    try! JSONSerialization.jsonObject(with: JSONSerialization.data(withJSONObject: value)) as! NSObject
}

private func date(_ value: Any?) -> Date? {
    guard let text = value as? String else { return nil }
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime]
    return formatter.date(from: text)
}

final class MeldReadyRunsTests: XCTestCase {
    func testAnUnknownRequestIdIsIgnored() {
        let runs = MeldReadyRuns<Int>()
        var answers: [[String: Any]] = []
        XCTAssertTrue(runs.start("run"))
        let requestId = runs.ask("run") { answers.append($0) }
        XCTAssertNotNil(requestId)
        XCTAssertFalse(runs.respond("run", requestId: "999", json: #"{"accepted":true}"#))
        XCTAssertFalse(runs.respond("other-run", requestId: requestId!, json: #"{"accepted":true}"#))
        XCTAssertTrue(answers.isEmpty)
        XCTAssertTrue(runs.respond("run", requestId: requestId!, json: #"{"accepted":true}"#))
        XCTAssertFalse(runs.respond("run", requestId: requestId!, json: #"{"accepted":false}"#))
        XCTAssertEqual(answers.count, 1)
        XCTAssertTrue(MeldReadyAnswer.accepted(answers[0]))
    }

    func testRequestsGetDistinctIdsAndAreAnsweredSeparately() {
        let runs = MeldReadyRuns<Int>()
        var answered: [String] = []
        _ = runs.start("a")
        _ = runs.start("b")
        let first = runs.ask("a") { _ in answered.append("first") }!
        let second = runs.ask("b") { _ in answered.append("second") }!
        XCTAssertNotEqual(first, second)
        XCTAssertFalse(runs.respond("a", requestId: second, json: "{}"))
        runs.respond("b", requestId: second, json: "{}")
        runs.respond("a", requestId: first, json: "{}")
        XCTAssertEqual(answered, ["second", "first"])
    }

    func testAFinishedRunDropsItsRequestsAndAsksNoMore() {
        let runs = MeldReadyRuns<Int>()
        var answered = false
        _ = runs.start("run")
        runs.attach(7, to: "run")
        let requestId = runs.ask("run") { _ in answered = true }!
        runs.finish("run")
        XCTAssertFalse(runs.respond("run", requestId: requestId, json: "{}"))
        XCTAssertNil(runs.ask("run") { _ in XCTFail() })
        XCTAssertNil(runs.handle("run"))
        XCTAssertFalse(answered)
    }

    func testARunIdIsNotReusedWhileRunningAndFinishAllReturnsEveryHandle() {
        let runs = MeldReadyRuns<Int>()
        XCTAssertTrue(runs.start("a"))
        XCTAssertFalse(runs.start("a"))
        _ = runs.start("b")
        runs.attach(1, to: "a")
        runs.attach(2, to: "b")
        runs.attach(3, to: "never-started")
        XCTAssertEqual(runs.handle("a"), 1)
        XCTAssertEqual(runs.finishAll().sorted(), [1, 2])
        XCTAssertNil(runs.handle("a"))
        XCTAssertTrue(runs.start("a"))
    }

    func testAMalformedAnswerStillAnswersAndDeclines() {
        let runs = MeldReadyRuns<Int>()
        var reply: [String: Any]?
        _ = runs.start("run")
        let requestId = runs.ask("run") { reply = $0 }!
        XCTAssertTrue(runs.respond("run", requestId: requestId, json: "not json"))
        XCTAssertNotNil(reply)
        XCTAssertNil(MeldReadyAnswer.values(reply!))
        XCTAssertFalse(MeldReadyAnswer.accepted(reply!))
        XCTAssertNil(MeldReadyAnswer.session(reply!))
    }
}

final class MeldReadyAnswerTests: XCTestCase {
    private func reply(_ text: String) -> [String: Any] {
        try! JSONSerialization.jsonObject(with: Data(text.utf8)) as! [String: Any]
    }

    func testCollectedValuesAreStringsByKeyOrNil() {
        XCTAssertEqual(MeldReadyAnswer.values(reply(#"{"values":{"email":"synthetic@example.test"}}"#)),
                       ["email": "synthetic@example.test"])
        XCTAssertEqual(MeldReadyAnswer.values(reply(#"{"values":{}}"#)), [:])
        for text in [#"{"values":null}"#, #"{}"#, #"{"values":{"email":1}}"#, #"{"values":["email"]}"#, #"{"values":"x"}"#] {
            XCTAssertNil(MeldReadyAnswer.values(reply(text)), text)
        }
    }

    func testOnlyAJsonTrueAccepts() {
        XCTAssertTrue(MeldReadyAnswer.accepted(reply(#"{"accepted":true}"#)))
        for text in [#"{"accepted":false}"#, #"{"accepted":1}"#, #"{"accepted":"true"}"#, #"{}"#] {
            XCTAssertFalse(MeldReadyAnswer.accepted(reply(text)), text)
        }
    }

    func testARenewedSessionIsPassedOnAsJson() throws {
        let data = try XCTUnwrap(MeldReadyAnswer.session(reply(#"{"session":{"id":"Ny9YeB5gTh8WaQc3DrUf7k","token":"t"}}"#)))
        XCTAssertEqual(json(try JSONSerialization.jsonObject(with: data)), json(["id": "Ny9YeB5gTh8WaQc3DrUf7k", "token": "t"]))
        XCTAssertNil(MeldReadyAnswer.session(reply(#"{"session":null}"#)))
        XCTAssertNil(MeldReadyAnswer.session(reply(#"{"session":"token"}"#)))
    }

    func testOptionsCarryTheTimeoutAndTheSuppliedHandlers() {
        let options = MeldReadyOptionsInput(json: #"{"waitTimeoutMs":30000,"handlers":["collect","confirmAgreement",3]}"#)
        XCTAssertEqual(options.waitTimeoutMs, 30000)
        XCTAssertEqual(options.handlers, ["collect", "confirmAgreement"])
        for text in [#"{"handlers":[]}"#, #"{"waitTimeoutMs":-1}"#, #"{"waitTimeoutMs":true}"#, #"{"waitTimeoutMs":"5"}"#, "x"] {
            let parsed = MeldReadyOptionsInput(json: text)
            XCTAssertNil(parsed.waitTimeoutMs, text)
            XCTAssertTrue(parsed.handlers.isEmpty, text)
        }
        XCTAssertEqual(MeldReadyOptionsInput(json: #"{"waitTimeoutMs":1e300}"#).waitTimeoutMs, Int(Int32.max))
        XCTAssertEqual(MeldReadyOptionsInput(json: #"{"waitTimeoutMs":0}"#).waitTimeoutMs, 0)
    }
}

final class MeldReadyEventTests: XCTestCase {
    func testTheEventNamesItsRunAndOnlyARequestCarriesARequestId() {
        XCTAssertEqual(json(MeldReadyEvent.event(handleId: "run", type: "result", payload: ["status": "READY"])),
                       json(["handleId": "run", "type": "result", "payload": ["status": "READY"]]))
        XCTAssertEqual(json(MeldReadyEvent.event(handleId: "run", requestId: "4", type: "collect", payload: [:])),
                       json(["handleId": "run", "requestId": "4", "type": "collect", "payload": [:]]))
    }

    func testEveryStepOfEveryFixtureReadReachesJavaScriptUnchanged() throws {
        let directory = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent("../fixtures/requirements-fixtures/requirements-session").standardized
        var compared = 0
        for name in try FileManager.default.contentsOfDirectory(atPath: directory.path).sorted() where name.hasSuffix(".json") {
            let fixture = try JSONSerialization.jsonObject(with: Data(contentsOf: directory.appendingPathComponent(name))) as! [String: Any]
            for exchange in fixture["exchanges"] as! [[String: Any]] where exchange["operation"] as? String == "READ" {
                guard let next = (exchange["response"] as? [String: Any])?["next"] as? [[String: Any]] else { continue }
                for wire in next {
                    let step = TestStep(
                        stepId: wire["stepId"] as! String, kind: wire["kind"] as! String, type: wire["type"] as! String,
                        code: wire["code"] as! String, serviceProviders: wire["serviceProviders"] as! [String],
                        level: wire["level"] as? String, url: wire["url"] as? String, expiresAt: date(wire["expiresAt"]),
                        fields: (wire["fields"] as? [[String: Any]])?.map {
                            TestField(key: $0["key"] as! String, label: $0["label"] as? String, fieldType: $0["fieldType"] as? String,
                                  jsonSchema: $0["jsonSchema"] as? String, allowedValues: $0["allowedValues"] as? [String])
                        },
                        reason: wire["reason"] as? String)
                    XCTAssertEqual(json(MeldReadyEvent.step(step)), json(wire), "\(name) \(step.stepId)")
                    compared += 1
                }
            }
        }
        XCTAssertGreaterThanOrEqual(compared, 8)
    }

    func testEveryOpenRequirementOfEveryFixtureReadReachesJavaScriptWithItsReasonAndErrorCodes() throws {
        let directory = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent("../fixtures/requirements-fixtures/requirements-session").standardized
        var withCodes = 0
        for name in try FileManager.default.contentsOfDirectory(atPath: directory.path).sorted() where name.hasSuffix(".json") {
            let fixture = try JSONSerialization.jsonObject(with: Data(contentsOf: directory.appendingPathComponent(name))) as! [String: Any]
            for exchange in fixture["exchanges"] as! [[String: Any]] where exchange["operation"] as? String == "READ" {
                guard let wire = (exchange["response"] as? [String: Any])?["providers"] as? [[String: Any]] else { continue }
                let open = { (provider: [String: Any]) in (provider["requirements"] as! [[String: Any]]).filter {
                    $0["timing"] as? String == "PRE_ORDER" && $0["status"] as? String != "SATISFIED"
                } }
                let providers = wire.map { provider in
                    TestProvider(serviceProvider: provider["serviceProvider"] as! String, status: provider["status"] as! String,
                                 eligible: provider["eligible"] as? Bool, open: open(provider).map {
                        TestRequirement(type: $0["type"] as! String, code: $0["code"] as! String, status: $0["status"] as! String,
                                        reason: $0["reason"] as? String, errorCodes: $0["errorCodes"] as? [String])
                    })
                }
                let expected = wire.map { provider -> [String: Any] in
                    ["serviceProvider": provider["serviceProvider"]!, "status": provider["status"]!,
                     "eligible": provider["eligible"] ?? NSNull(),
                     "open": open(provider).map { $0.filter { ["type", "code", "status", "reason", "errorCodes"].contains($0.key) } }]
                }
                withCodes += providers.flatMap(\.open).filter { $0.errorCodes != nil }.count
                let result = MeldReadyEvent.result(RunResult(status: .blocked, providers: providers))
                XCTAssertEqual(json(result["providers"]!), json(expected), name)
            }
        }
        XCTAssertGreaterThanOrEqual(withCodes, 1, "a fixture has a share refused with errorCodes")
    }

    func testACollectRequestNamesItsFieldsAndErrorsButCarriesNoValue() {
        let request = TestCollect(reason: "MISSING", fieldErrors: [TestFieldError(key: "name.lastName", reason: "INVALID")])
        XCTAssertEqual(json(MeldReadyEvent.collect(request)), json([
            "stepId": "*:CUSTOMER_DETAILS:CUSTOMER_NAME", "type": "CUSTOMER_DETAILS", "code": "CUSTOMER_NAME",
            "serviceProviders": ["UPHOLD"],
            "fields": [["key": "name.firstName", "label": "First name"], ["key": "name.lastName"]],
            "reason": "MISSING", "fieldErrors": [["key": "name.lastName", "reason": "INVALID"]],
        ]))
        XCTAssertEqual(json(MeldReadyEvent.collect(TestCollect())), json([
            "stepId": "*:CUSTOMER_DETAILS:CUSTOMER_NAME", "type": "CUSTOMER_DETAILS", "code": "CUSTOMER_NAME",
            "serviceProviders": ["UPHOLD"],
            "fields": [["key": "name.firstName", "label": "First name"], ["key": "name.lastName"]],
        ]))
    }

    func testAgreementPageAndProgressRequests() {
        XCTAssertEqual(json(MeldReadyEvent.agreement(TestAgreement(stepId: "UPHOLD:AGREEMENT:TERMS", serviceProvider: "UPHOLD",
                                                               code: "TERMS", url: URL(string: "https://example.test/terms")))),
                       json(["stepId": "UPHOLD:AGREEMENT:TERMS", "serviceProvider": "UPHOLD", "code": "TERMS",
                             "url": "https://example.test/terms"]))
        XCTAssertEqual(json(MeldReadyEvent.agreement(TestAgreement(stepId: "s", serviceProvider: "P", code: "C", url: nil))),
                       json(["stepId": "s", "serviceProvider": "P", "code": "C"]))
        XCTAssertEqual(json(MeldReadyEvent.presentUrl(TestPresentUrl(stepId: "s", url: URL(string: "https://example.test/kyc")!,
                                                                 expiresAt: date("2026-11-04T15:28:30Z")))),
                       json(["stepId": "s", "url": "https://example.test/kyc", "expiresAt": "2026-11-04T15:28:30Z"]))
        XCTAssertEqual(json(MeldReadyEvent.progress(TestProgress(state: .waiting, snapshot: ["status": "WAITING"]))),
                       json(["state": "WAITING", "snapshot": ["status": "WAITING"]]))
        XCTAssertEqual(json(MeldReadyEvent.progress(TestProgress(state: .waiting, snapshot: nil))),
                       json(["state": "WAITING", "snapshot": NSNull()]))
    }

    func testAResultCarriesPendingAndErrorOnlyWhenTheRunHasThem() {
        let providers = [
            TestProvider(serviceProvider: "BANXA", status: "ACTION_REQUIRED", eligible: false,
                     open: [TestRequirement(type: "MELD_KYC", code: "MELD_KYC", status: "REQUIRED", reason: nil)]),
            TestProvider(serviceProvider: "UPHOLD", status: "UNDETERMINED", eligible: nil, open: []),
            TestProvider(serviceProvider: "COINME", status: "BLOCKED", eligible: false,
                         open: [TestRequirement(type: "PROVIDER_KYC_SHARE", code: "PROVIDER_KYC_SHARE", status: "BLOCKED",
                                                reason: "R", errorCodes: ["PHONE_VERIFICATION_REQUIRED"])]),
        ]
        XCTAssertEqual(json(MeldReadyEvent.result(RunResult(
            status: .actionRequired, providers: providers, pending: [TestStep(level: "LEVEL_2")],
            continuation: [TestContinuation(serviceProvider: "STRIPE", code: "IDENTITY", nextStep: nil)]))), json([
                "status": "ACTION_REQUIRED",
                "providers": [
                    ["serviceProvider": "BANXA", "status": "ACTION_REQUIRED", "eligible": false,
                     "open": [["type": "MELD_KYC", "code": "MELD_KYC", "status": "REQUIRED"]]],
                    ["serviceProvider": "UPHOLD", "status": "UNDETERMINED", "eligible": NSNull(), "open": []],
                    ["serviceProvider": "COINME", "status": "BLOCKED", "eligible": false,
                     "open": [["type": "PROVIDER_KYC_SHARE", "code": "PROVIDER_KYC_SHARE", "status": "BLOCKED", "reason": "R",
                               "errorCodes": ["PHONE_VERIFICATION_REQUIRED"]]]],
                ],
                "pending": [["stepId": "*:MELD_KYC:MELD_KYC", "kind": "SUBMIT", "type": "MELD_KYC", "code": "MELD_KYC",
                             "serviceProviders": ["BANXA"], "level": "LEVEL_2"]],
                "continuation": [["serviceProvider": "STRIPE", "code": "IDENTITY"]],
            ]))
        XCTAssertEqual(json(MeldReadyEvent.result(RunResult(status: .ready))),
                       json(["status": "READY", "providers": [], "continuation": []]))
        XCTAssertEqual(json(MeldReadyEvent.result(RunResult(status: .failed, error: TestFailure(kind: .http, status: 403, code: nil)))),
                       json(["status": "FAILED", "providers": [], "continuation": [], "error": ["kind": "http", "status": 403]]))
        XCTAssertEqual(json(MeldReadyEvent.protocolFailure),
                       json(["status": "FAILED", "providers": [], "continuation": [], "error": ["kind": "protocol"]]))
    }

    func testTimestampsAreUtcToTheSecond() {
        XCTAssertEqual(MeldReadyEvent.timestamp(Date(timeIntervalSince1970: 1_793_806_110.75)), "2026-11-04T15:28:30Z")
    }
}
