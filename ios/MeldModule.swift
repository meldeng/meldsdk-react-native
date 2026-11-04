import React
import MeldSDK

/// The imperative Meld API (`configure` / `capabilities`) exposed to JS as
/// `NativeModules.MeldModule`. Kept separate from the view manager so it's an unambiguous native
/// module on both the Old Architecture and the New-Architecture interop layer (a view manager's
/// exported methods aren't reliably reachable as a module under Fabric). Mirrors the Android
/// `MeldWidgetModule` (also named "MeldModule"). An event emitter for `ensureReady`'s `MeldReadyEvent`.
@objc(MeldModule)
final class MeldModule: RCTEventEmitter {
    private let runs = MeldReadyRuns<MeldReadyHandle>()

    @objc override static func requiresMainQueueSetup() -> Bool { true }
    @objc override var methodQueue: DispatchQueue { .main }
    @objc override func constantsToExport() -> [AnyHashable: Any]! { ["headlessProtocolVersion": 1] }
    override func supportedEvents() -> [String]! { [MeldReadyEvent.name] }

    override func invalidate() {
        runs.finishAll().forEach { $0.cancel() }
        super.invalidate()
    }

    @objc func configure(_ environment: NSString) {
        // Parsed by raw value rather than a "production or else sandbox" test: silently collapsing
        // an unrecognised environment to sandbox is how a QA build ends up posting to the sandbox
        // API and never finding its order.
        let parsed = MeldEnvironment(rawValue: environment as String) ?? .sandbox
        Meld.configure(environment: parsed)
    }

    /// Inspect an order before rendering the widget — bridges to `Meld.capabilities(for:)`.
    @objc func capabilities(_ order: NSDictionary,
                            resolver resolve: @escaping RCTPromiseResolveBlock,
                            rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let data = try? JSONSerialization.data(withJSONObject: order),
              let parsed = try? MeldOrder.from(jsonData: data) else {
            reject("invalid_order", "Could not parse the order JSON", nil)
            return
        }
        let caps = Meld.capabilities(for: parsed)
        resolve([
            "embeddable": caps.embeddable,
            "surface": caps.surface,
            "requiresUserGesture": caps.requiresUserGesture,
        ])
    }

    /// Advisory descriptor support from the installed adapter registry; no order or network request.
    @objc func presentationCapabilities(_ paymentMethodType: NSString,
                                        presentation: NSDictionary,
                                        resolver resolve: @escaping RCTPromiseResolveBlock,
                                        rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let json = presentation as? [String: Any],
              let descriptor = MeldHeadlessPresentation(json: json) else {
            resolve(["embeddable": false, "surface": "unsupported", "requiresUserGesture": false])
            return
        }
        let caps = Meld.capabilities(for: descriptor, paymentMethodType: paymentMethodType as String)
        resolve([
            "embeddable": caps.embeddable,
            "surface": caps.surface,
            "requiresUserGesture": caps.requiresUserGesture,
        ])
    }

    /// Device readiness for a payment method before any quote, from the native SDK; no order or network request.
    @objc func paymentMethodReadiness(_ paymentMethodType: NSString,
                                      resolver resolve: @escaping RCTPromiseResolveBlock,
                                      rejecter reject: @escaping RCTPromiseRejectBlock) {
        Meld.paymentMethodReadiness(paymentMethodType as String) { resolve(Self.payload($0)) }
    }

    /// Device readiness for a quote row's method, from the native SDK; no order or network request.
    @objc func presentationReadiness(_ paymentMethodType: NSString,
                                     presentation: NSDictionary,
                                     resolver resolve: @escaping RCTPromiseResolveBlock,
                                     rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let json = presentation as? [String: Any],
              let descriptor = MeldHeadlessPresentation(json: json) else {
            resolve(MeldReadinessEvent.unavailable(code: MeldErrorCode.paymentMethodUnavailable,
                                                   reason: "The headlessPresentation is malformed."))
            return
        }
        Meld.presentationReadiness(descriptor, paymentMethodType: paymentMethodType as String) { resolve(Self.payload($0)) }
    }

    /// Runs a requirements session for JavaScript; requests and the result arrive as `MeldReadyEvent`.
    @objc func ensureReady(_ handleId: NSString, sessionJson: NSString, optionsJson: NSString) {
        let handleId = handleId as String
        guard runs.start(handleId) else { return }
        guard let session = try? MeldRequirementsSession.from(jsonString: sessionJson as String) else {
            return finish(handleId, MeldReadyEvent.protocolFailure)
        }
        let options = MeldReadyOptionsInput(json: optionsJson as String)
        let handle = Meld.ensureReady(session: session, handlers: handlers(handleId, options.handlers),
                                      options: MeldReadyOptions(waitTimeoutMs: options.waitTimeoutMs ?? 600_000)) { [weak self] result in
            self?.finish(handleId, MeldReadyEvent.result(result))
        }
        runs.attach(handle, to: handleId)
    }

    /// The app's answer to one request. An unknown or already answered request is ignored.
    @objc func respond(_ handleId: NSString, requestId: NSString, json: NSString) {
        runs.respond(handleId as String, requestId: requestId as String, json: json as String)
    }

    @objc func refresh(_ handleId: NSString) { runs.handle(handleId as String)?.refresh() }

    @objc func cancel(_ handleId: NSString) { runs.handle(handleId as String)?.cancel() }

    /// Shows a hosted verification page behind the SDK's Continue prompt; resolves once it is closed.
    @objc func openHostedVerification(_ url: NSString,
                                      resolver resolve: @escaping RCTPromiseResolveBlock,
                                      rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let page = URL(string: url as String), page.scheme == "https" else {
            reject("invalid_url", "openHostedVerification opens https pages only.", nil)
            return
        }
        Meld.openHostedVerification(url: page) { resolve(nil) }
    }

    private func handlers(_ handleId: String, _ names: Set<String>) -> MeldReadyHandlers {
        var handlers = MeldReadyHandlers()
        if names.contains("onProgress") {
            handlers.onProgress = { [weak self] progress in
                self?.emit(handleId, type: "progress", MeldReadyEvent.progress(progress))
            }
        }
        if names.contains("collect") {
            handlers.collect = { [weak self] request, done in
                self?.ask(handleId, type: "collect", MeldReadyEvent.collect(request)) { done(MeldReadyAnswer.values($0)) }
            }
        }
        if names.contains("confirmAgreement") {
            handlers.confirmAgreement = { [weak self] request, done in
                self?.ask(handleId, type: "confirmAgreement", MeldReadyEvent.agreement(request)) { done(MeldReadyAnswer.accepted($0)) }
            }
        }
        if names.contains("presentUrl") {
            handlers.presentUrl = { [weak self] request, done in
                self?.ask(handleId, type: "presentUrl", MeldReadyEvent.presentUrl(request)) { _ in done() }
            }
        }
        if names.contains("renewSession") {
            handlers.renewSession = { [weak self] done in
                self?.ask(handleId, type: "renewSession", [:]) { reply in
                    done(MeldReadyAnswer.session(reply).flatMap { try? MeldRequirementsSession.from(jsonData: $0) })
                }
            }
        }
        return handlers
    }

    private func ask(_ handleId: String, type: String, _ payload: [String: Any], answer: @escaping ([String: Any]) -> Void) {
        guard let requestId = runs.ask(handleId, answer: answer) else { return }
        emit(handleId, requestId: requestId, type: type, payload)
    }

    private func finish(_ handleId: String, _ result: [String: Any]) {
        emit(handleId, type: "result", result)
        runs.finish(handleId)
    }

    private func emit(_ handleId: String, requestId: String? = nil, type: String, _ payload: [String: Any]) {
        sendEvent(withName: MeldReadyEvent.name,
                  body: MeldReadyEvent.event(handleId: handleId, requestId: requestId, type: type, payload: payload))
    }

    private static func payload(_ readiness: MeldReadiness) -> [String: Any] {
        switch readiness {
        case .ready:
            return MeldReadinessEvent.ready
        case let .unavailable(code, reason):
            return MeldReadinessEvent.unavailable(code: code, reason: reason)
        case let .unknown(reason):
            return MeldReadinessEvent.unknown(reason: reason)
        }
    }
}

extension MeldReadyField: ReadyFieldValues {}
extension MeldReadyStep: ReadyStepValues {}
extension MeldReadyRequirement: ReadyRequirementValues {}
extension MeldReadyProvider: ReadyProviderValues {}
extension MeldReadyContinuation: ReadyContinuationValues {}
extension MeldReadyError: ReadyErrorValues {}
extension MeldReadyResult: ReadyResultValues {}
extension MeldFieldError: ReadyFieldErrorValues {}
extension MeldCollectRequest: ReadyCollectValues {}
extension MeldAgreementRequest: ReadyAgreementValues {}
extension MeldPresentUrlRequest: ReadyPresentUrlValues {}
extension MeldReadyProgress: ReadyProgressValues {}
