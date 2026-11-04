import Foundation

// The members of MeldSDK's requirements types the bridge reads. MeldModule conforms the MeldSDK types, so the
// JavaScript payloads are built, and tested, without MeldSDK.
protocol ReadyFieldValues {
    var key: String { get }
    var label: String? { get }
    var fieldType: String? { get }
    var jsonSchema: String? { get }
    var allowedValues: [String]? { get }
}

protocol ReadyStepValues {
    associatedtype Field: ReadyFieldValues
    var stepId: String { get }
    var kind: String { get }
    var type: String { get }
    var code: String { get }
    var serviceProviders: [String] { get }
    var level: String? { get }
    var url: String? { get }
    var expiresAt: Date? { get }
    var fields: [Field]? { get }
    var reason: String? { get }
}

protocol ReadyRequirementValues {
    var type: String { get }
    var code: String { get }
    var status: String { get }
    var reason: String? { get }
    var errorCodes: [String]? { get }
}

protocol ReadyProviderValues {
    associatedtype Requirement: ReadyRequirementValues
    var serviceProvider: String { get }
    var status: String { get }
    var eligible: Bool? { get }
    var open: [Requirement] { get }
}

protocol ReadyContinuationValues {
    var serviceProvider: String { get }
    var code: String { get }
    var nextStep: String? { get }
}

protocol ReadyErrorValues {
    associatedtype Kind: RawRepresentable where Kind.RawValue == String
    var kind: Kind { get }
    var status: Int? { get }
    var code: String? { get }
}

protocol ReadyResultValues {
    associatedtype Status: RawRepresentable where Status.RawValue == String
    associatedtype Provider: ReadyProviderValues
    associatedtype Step: ReadyStepValues
    associatedtype Continuation: ReadyContinuationValues
    associatedtype Failure: ReadyErrorValues
    var status: Status { get }
    var providers: [Provider] { get }
    var pending: [Step]? { get }
    var continuation: [Continuation] { get }
    var error: Failure? { get }
}

protocol ReadyFieldErrorValues {
    var key: String { get }
    var reason: String { get }
}

protocol ReadyCollectValues {
    associatedtype Field: ReadyFieldValues
    associatedtype FieldError: ReadyFieldErrorValues
    var stepId: String { get }
    var type: String { get }
    var code: String { get }
    var serviceProviders: [String] { get }
    var fields: [Field] { get }
    var reason: String? { get }
    var fieldErrors: [FieldError]? { get }
}

protocol ReadyAgreementValues {
    var stepId: String { get }
    var serviceProvider: String { get }
    var code: String { get }
    var url: URL? { get }
}

protocol ReadyPresentUrlValues {
    var stepId: String { get }
    var url: URL { get }
    var expiresAt: Date? { get }
}

protocol ReadyProgressValues {
    associatedtype State: RawRepresentable where State.RawValue == String
    var state: State { get }
    var snapshot: [String: Any]? { get }
}

/// The `MeldReadyEvent` JavaScript receives: `{handleId, requestId?, type, payload}`. Payloads carry what the
/// native run asks or reports, never a value the app collected.
enum MeldReadyEvent {
    static let name = "MeldReadyEvent"

    static func event(handleId: String, requestId: String? = nil, type: String, payload: [String: Any]) -> [String: Any] {
        var event: [String: Any] = ["handleId": handleId, "type": type, "payload": payload]
        if let requestId { event["requestId"] = requestId }
        return event
    }

    static func result<R: ReadyResultValues>(_ result: R) -> [String: Any] {
        var payload: [String: Any] = [
            "status": result.status.rawValue,
            "providers": result.providers.map(provider),
            "continuation": result.continuation.map { continuation in
                var entry: [String: Any] = ["serviceProvider": continuation.serviceProvider, "code": continuation.code]
                entry["nextStep"] = continuation.nextStep
                return entry
            },
        ]
        if let pending = result.pending { payload["pending"] = pending.map(step) }
        if let error = result.error {
            var failure: [String: Any] = ["kind": error.kind.rawValue]
            failure["status"] = error.status
            failure["code"] = error.code
            payload["error"] = failure
        }
        return payload
    }

    /// The run could not start: the session is not one this SDK can run.
    static let protocolFailure: [String: Any] = [
        "status": "FAILED", "providers": [] as [Any], "continuation": [] as [Any], "error": ["kind": "protocol"],
    ]

    static func step<S: ReadyStepValues>(_ step: S) -> [String: Any] {
        var payload: [String: Any] = [
            "stepId": step.stepId, "kind": step.kind, "type": step.type, "code": step.code,
            "serviceProviders": step.serviceProviders,
        ]
        payload["level"] = step.level
        payload["url"] = step.url
        payload["expiresAt"] = step.expiresAt.map(timestamp)
        if let fields = step.fields, !fields.isEmpty { payload["fields"] = fields.map(field) }
        payload["reason"] = step.reason
        return payload
    }

    static func collect<C: ReadyCollectValues>(_ request: C) -> [String: Any] {
        var payload: [String: Any] = [
            "stepId": request.stepId, "type": request.type, "code": request.code,
            "serviceProviders": request.serviceProviders, "fields": request.fields.map(field),
        ]
        payload["reason"] = request.reason
        payload["fieldErrors"] = request.fieldErrors?.map { ["key": $0.key, "reason": $0.reason] }
        return payload
    }

    static func agreement<A: ReadyAgreementValues>(_ request: A) -> [String: Any] {
        var payload: [String: Any] = [
            "stepId": request.stepId, "serviceProvider": request.serviceProvider, "code": request.code,
        ]
        payload["url"] = request.url?.absoluteString
        return payload
    }

    static func presentUrl<P: ReadyPresentUrlValues>(_ request: P) -> [String: Any] {
        var payload: [String: Any] = ["stepId": request.stepId, "url": request.url.absoluteString]
        payload["expiresAt"] = request.expiresAt.map(timestamp)
        return payload
    }

    static func progress<P: ReadyProgressValues>(_ progress: P) -> [String: Any] {
        ["state": progress.state.rawValue, "snapshot": progress.snapshot ?? NSNull()]
    }

    /// ISO-8601 UTC with second precision, as the session sends it.
    static func timestamp(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.string(from: date)
    }

    private static func provider<P: ReadyProviderValues>(_ provider: P) -> [String: Any] {
        [
            "serviceProvider": provider.serviceProvider,
            "status": provider.status,
            "eligible": provider.eligible.map { $0 as Any } ?? NSNull(),
            "open": provider.open.map { requirement in
                var entry: [String: Any] = ["type": requirement.type, "code": requirement.code, "status": requirement.status]
                entry["reason"] = requirement.reason
                entry["errorCodes"] = requirement.errorCodes
                return entry
            },
        ]
    }

    private static func field<F: ReadyFieldValues>(_ field: F) -> [String: Any] {
        var payload: [String: Any] = ["key": field.key]
        payload["label"] = field.label
        payload["fieldType"] = field.fieldType
        payload["jsonSchema"] = field.jsonSchema
        payload["allowedValues"] = field.allowedValues
        return payload
    }
}

/// What JavaScript passed to `ensureReady` besides the session.
struct MeldReadyOptionsInput {
    let waitTimeoutMs: Int?
    /// The handlers the app supplied; native asks only through these.
    let handlers: Set<String>

    init(json: String) {
        let object = (try? JSONSerialization.jsonObject(with: Data(json.utf8))) as? [String: Any] ?? [:]
        if let number = object["waitTimeoutMs"] as? NSNumber, !MeldReadyAnswer.isBool(number),
           number.doubleValue.isFinite, number.doubleValue >= 0 {
            waitTimeoutMs = Int(min(number.doubleValue, Double(Int32.max)))
        } else {
            waitTimeoutMs = nil
        }
        handlers = Set((object["handlers"] as? [Any] ?? []).compactMap { $0 as? String })
    }
}

/// The app's answer to one request, read from the JSON `respond` carries. A malformed answer declines.
enum MeldReadyAnswer {
    /// The values by field key, or nil when the app handled the step itself.
    static func values(_ reply: [String: Any]) -> [String: String]? {
        guard let values = reply["values"] as? [String: Any] else { return nil }
        var strings: [String: String] = [:]
        for (key, value) in values {
            guard let text = value as? String else { return nil }
            strings[key] = text
        }
        return strings
    }

    static func accepted(_ reply: [String: Any]) -> Bool {
        guard let value = reply["accepted"] as? NSNumber, isBool(value) else { return false }
        return value.boolValue
    }

    /// The renewed session as JSON, for `MeldRequirementsSession.from(jsonData:)`.
    static func session(_ reply: [String: Any]) -> Data? {
        guard let session = reply["session"] as? [String: Any] else { return nil }
        return try? JSONSerialization.data(withJSONObject: session)
    }

    static func isBool(_ number: NSNumber) -> Bool { CFGetTypeID(number) == CFBooleanGetTypeID() }
}

/// The runs JavaScript started, and the requests each is waiting on, by id. Main thread only.
final class MeldReadyRuns<Handle> {
    private final class Run {
        var handle: Handle?
        var requests: [String: ([String: Any]) -> Void] = [:]
    }

    private var runs: [String: Run] = [:]
    private var lastRequest = 0

    /// False when a run with this id is already going.
    func start(_ handleId: String) -> Bool {
        guard runs[handleId] == nil else { return false }
        runs[handleId] = Run()
        return true
    }

    func attach(_ handle: Handle, to handleId: String) { runs[handleId]?.handle = handle }

    func handle(_ handleId: String) -> Handle? { runs[handleId]?.handle }

    /// The id JavaScript answers with, or nil once the run ended.
    func ask(_ handleId: String, answer: @escaping ([String: Any]) -> Void) -> String? {
        guard let run = runs[handleId] else { return nil }
        lastRequest += 1
        let requestId = String(lastRequest)
        run.requests[requestId] = answer
        return requestId
    }

    /// Answers a request once. An unknown run or request, or one already answered, is ignored.
    @discardableResult
    func respond(_ handleId: String, requestId: String, json: String) -> Bool {
        guard let answer = runs[handleId]?.requests.removeValue(forKey: requestId) else { return false }
        answer((try? JSONSerialization.jsonObject(with: Data(json.utf8))) as? [String: Any] ?? [:])
        return true
    }

    /// Ends a run. Its unanswered requests are dropped.
    func finish(_ handleId: String) { runs[handleId] = nil }

    /// Ends every run, as when the bridge reloads, and returns their handles to cancel.
    func finishAll() -> [Handle] {
        let handles = runs.values.compactMap(\.handle)
        runs.removeAll()
        return handles
    }
}
