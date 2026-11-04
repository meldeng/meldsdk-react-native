package io.meld.rn

import io.meld.sdk.requirements.MeldAgreementRequest
import io.meld.sdk.requirements.MeldCollectField
import io.meld.sdk.requirements.MeldCollectRequest
import io.meld.sdk.requirements.MeldPresentUrlRequest
import io.meld.sdk.requirements.MeldReadyHandle
import io.meld.sdk.requirements.MeldReadyHandlers
import io.meld.sdk.requirements.MeldReadyOptions
import io.meld.sdk.requirements.MeldReadyResult
import io.meld.sdk.requirements.MeldReadyStep
import io.meld.sdk.requirements.MeldRequirementsSession
import io.meld.sdk.requirements.MeldRequirementsSessionException
import org.json.JSONException
import org.json.JSONObject

internal const val READY_EVENT = "MeldReadyEvent"

/** Starts the native run and returns its handle, or null when nothing can present it. */
internal typealias ReadyStarter =
    (MeldRequirementsSession, MeldReadyHandlers, MeldReadyOptions, (MeldReadyResult) -> Unit) -> MeldReadyHandle?

/**
 * `ensureReady` for JS, built from plain values so it can be tested without React Native. Each run sends
 * `MeldReadyEvent` `{handleId, requestId?, type, payload}`; payloads carry what the run asks or reports, never a
 * value the app collected. Main thread only.
 */
internal class MeldReadyBridge(private val emit: (Map<String, Any?>) -> Unit) {
    private val runs = MeldReadyRuns<MeldReadyHandle>()

    fun start(handleId: String, sessionJson: String, optionsJson: String, starter: ReadyStarter) {
        if (!runs.start(handleId)) return
        val session = try {
            MeldRequirementsSession.fromJson(sessionJson)
        } catch (e: MeldRequirementsSessionException) {
            return finish(handleId, protocolFailure())
        }
        val options = ReadyOptionsInput.parse(optionsJson)
        val handle = starter(session, handlers(handleId, options.handlers), MeldReadyOptions(options.waitTimeoutMs ?: 600_000)) {
            finish(handleId, resultPayload(it))
        } ?: return finish(handleId, protocolFailure())
        runs.attach(handle, handleId)
    }

    /** The app's answer to one request. An unknown or already answered request is ignored. */
    fun respond(handleId: String, requestId: String, json: String): Boolean = runs.respond(handleId, requestId, json)

    fun refresh(handleId: String) = runs.handle(handleId)?.refresh()

    fun cancel(handleId: String) = runs.handle(handleId)?.cancel()

    /** Cancels every run, as when the bridge reloads. */
    fun cancelAll() = runs.finishAll().forEach { it.cancel() }

    private fun handlers(handleId: String, names: Set<String>): MeldReadyHandlers {
        val all = MeldReadyHandlers(
            onProgress = { progress -> send(handleId, "progress", progressPayload(progress.state.name, progress.snapshot)) },
            collect = { request, answer -> ask(handleId, "collect", collectPayload(request)) { answer(collectedValues(it)) } },
            confirmAgreement = { request, answer ->
                ask(handleId, "confirmAgreement", agreementPayload(request)) { answer(it.opt("accepted") == true) }
            },
            presentUrl = { request, closed -> ask(handleId, "presentUrl", presentUrlPayload(request)) { closed() } },
            renewSession = { answer -> ask(handleId, "renewSession", emptyMap()) { answer(renewedSession(it)) } },
        )
        return MeldReadyHandlers(
            onProgress = all.onProgress.takeIf { "onProgress" in names },
            collect = all.collect.takeIf { "collect" in names },
            confirmAgreement = all.confirmAgreement.takeIf { "confirmAgreement" in names },
            presentUrl = all.presentUrl.takeIf { "presentUrl" in names },
            renewSession = all.renewSession.takeIf { "renewSession" in names },
        )
    }

    private fun ask(handleId: String, type: String, payload: Map<String, Any?>, answer: (JSONObject) -> Unit) {
        val requestId = runs.ask(handleId, answer) ?: return
        send(handleId, type, payload, requestId)
    }

    private fun finish(handleId: String, result: Map<String, Any?>) {
        send(handleId, "result", result)
        runs.finish(handleId)
    }

    private fun send(handleId: String, type: String, payload: Map<String, Any?>, requestId: String? = null) =
        emit(readyEvent(handleId, type, payload, requestId))
}

internal fun readyEvent(handleId: String, type: String, payload: Map<String, Any?>, requestId: String? = null): Map<String, Any?> =
    buildMap {
        put("handleId", handleId)
        requestId?.let { put("requestId", it) }
        put("type", type)
        put("payload", payload)
    }

internal fun resultPayload(result: MeldReadyResult): Map<String, Any?> = buildMap {
    put("status", result.status.name)
    put(
        "providers",
        result.providers.map { provider ->
            mapOf(
                "serviceProvider" to provider.serviceProvider,
                "status" to provider.status,
                "eligible" to provider.eligible,
                "open" to provider.open.map { open ->
                    buildMap {
                        put("type", open.type)
                        put("code", open.code)
                        put("status", open.status)
                        open.reason?.let { put("reason", it) }
                        open.errorCodes?.let { put("errorCodes", it) }
                    }
                },
            )
        },
    )
    result.pending?.let { pending -> put("pending", pending.map(::stepPayload)) }
    put(
        "continuation",
        result.continuation.map { step ->
            buildMap {
                put("serviceProvider", step.serviceProvider)
                put("code", step.code)
                step.nextStep?.let { put("nextStep", it) }
            }
        },
    )
    result.error?.let { error ->
        put(
            "error",
            buildMap {
                put("kind", error.kind.raw)
                error.status?.let { put("status", it) }
                error.code?.let { put("code", it) }
            },
        )
    }
}

/** The run could not start: the session is not one this SDK can run, or no Activity is on screen. */
internal fun protocolFailure(): Map<String, Any?> =
    mapOf("status" to "FAILED", "providers" to emptyList<Any>(), "continuation" to emptyList<Any>(), "error" to mapOf("kind" to "protocol"))

internal fun stepPayload(step: MeldReadyStep): Map<String, Any?> = buildMap {
    put("stepId", step.stepId)
    put("kind", step.kind)
    put("type", step.type)
    put("code", step.code)
    put("serviceProviders", step.serviceProviders)
    step.level?.let { put("level", it) }
    step.url?.let { put("url", it) }
    step.expiresAt?.let { put("expiresAt", it) }
    if (step.fields.isNotEmpty()) put("fields", step.fields.map(::fieldPayload))
    step.reason?.let { put("reason", it) }
}

internal fun collectPayload(request: MeldCollectRequest): Map<String, Any?> = buildMap {
    put("stepId", request.stepId)
    put("type", request.type)
    put("code", request.code)
    put("serviceProviders", request.serviceProviders)
    put("fields", request.fields.map(::fieldPayload))
    request.reason?.let { put("reason", it) }
    request.fieldErrors?.let { errors -> put("fieldErrors", errors.map { mapOf("key" to it.key, "reason" to it.reason) }) }
}

internal fun agreementPayload(request: MeldAgreementRequest): Map<String, Any?> = buildMap {
    put("stepId", request.stepId)
    put("serviceProvider", request.serviceProvider)
    put("code", request.code)
    request.url?.let { put("url", it) }
}

internal fun presentUrlPayload(request: MeldPresentUrlRequest): Map<String, Any?> = buildMap {
    put("stepId", request.stepId)
    put("url", request.url)
    request.expiresAt?.let { put("expiresAt", it) }
}

/** The latest READ as React Native can carry it: JSON values only, with every number an Int or a Double. */
internal fun progressPayload(state: String, snapshot: Map<String, Any?>?): Map<String, Any?> =
    mapOf("state" to state, "snapshot" to snapshot?.let(::jsonValue))

private fun fieldPayload(field: MeldCollectField): Map<String, Any?> = buildMap {
    put("key", field.key)
    field.label?.let { put("label", it) }
    field.fieldType?.let { put("fieldType", it) }
    field.jsonSchema?.let { put("jsonSchema", it) }
    field.allowedValues?.let { put("allowedValues", it) }
}

private fun jsonValue(value: Any?): Any? = when (value) {
    null, is Boolean, is String, is Int, is Double -> value
    is Number -> value.toLong().takeIf { it.toDouble() == value.toDouble() && it in Int.MIN_VALUE..Int.MAX_VALUE }?.toInt()
        ?: value.toDouble()
    is Map<*, *> -> value.entries.associate { (key, entry) -> key.toString() to jsonValue(entry) }
    is List<*> -> value.map(::jsonValue)
    else -> null
}

/** The values by field key, or null when the app handled the step itself or answered malformed values. */
internal fun collectedValues(reply: JSONObject): Map<String, String>? {
    val values = reply.opt("values") as? JSONObject ?: return null
    return values.keys().asSequence().associateWith { key -> values.opt(key) as? String ?: return null }
}

internal fun renewedSession(reply: JSONObject): MeldRequirementsSession? {
    val session = reply.opt("session") as? JSONObject ?: return null
    return try {
        MeldRequirementsSession.fromJson(session.toString())
    } catch (e: MeldRequirementsSessionException) {
        null
    }
}

/** What JS passed to `ensureReady` besides the session. */
internal class ReadyOptionsInput(val waitTimeoutMs: Long?, val handlers: Set<String>) {
    companion object {
        fun parse(json: String): ReadyOptionsInput {
            val options = try {
                JSONObject(json)
            } catch (e: JSONException) {
                JSONObject()
            }
            val timeout = (options.opt("waitTimeoutMs") as? Number)?.toDouble()?.takeIf { it.isFinite() && it >= 0 }
            val names = options.optJSONArray("handlers")
            return ReadyOptionsInput(
                timeout?.coerceAtMost(Int.MAX_VALUE.toDouble())?.toLong(),
                (0 until (names?.length() ?: 0)).mapNotNull { names?.opt(it) as? String }.toSet(),
            )
        }
    }
}

/** The runs JS started, and the requests each is waiting on, by id. Main thread only. */
internal class MeldReadyRuns<Handle : Any> {
    private class Run<Handle> {
        var handle: Handle? = null
        val requests = HashMap<String, (JSONObject) -> Unit>()
    }

    private val runs = HashMap<String, Run<Handle>>()
    private var lastRequest = 0L

    /** False when a run with this id is already going. */
    fun start(handleId: String): Boolean {
        if (runs.containsKey(handleId)) return false
        runs[handleId] = Run()
        return true
    }

    fun attach(handle: Handle, handleId: String) {
        runs[handleId]?.handle = handle
    }

    fun handle(handleId: String): Handle? = runs[handleId]?.handle

    /** The id JS answers with, or null once the run ended. */
    fun ask(handleId: String, answer: (JSONObject) -> Unit): String? {
        val run = runs[handleId] ?: return null
        val requestId = (++lastRequest).toString()
        run.requests[requestId] = answer
        return requestId
    }

    /** Answers a request once. An unknown run or request, or one already answered, is ignored. */
    fun respond(handleId: String, requestId: String, json: String): Boolean {
        val answer = runs[handleId]?.requests?.remove(requestId) ?: return false
        answer(
            try {
                JSONObject(json)
            } catch (e: JSONException) {
                JSONObject()
            },
        )
        return true
    }

    /** Ends a run. Its unanswered requests are dropped. */
    fun finish(handleId: String) {
        runs.remove(handleId)
    }

    fun finishAll(): List<Handle> {
        val handles = runs.values.mapNotNull { it.handle }
        runs.clear()
        return handles
    }
}
