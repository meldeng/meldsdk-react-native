package io.meld.rn

import io.meld.sdk.requirements.MeldAgreementRequest
import io.meld.sdk.requirements.MeldCollectField
import io.meld.sdk.requirements.MeldCollectRequest
import io.meld.sdk.requirements.MeldFieldError
import io.meld.sdk.requirements.MeldPresentUrlRequest
import io.meld.sdk.requirements.MeldReadyContinuation
import io.meld.sdk.requirements.MeldReadyError
import io.meld.sdk.requirements.MeldReadyErrorKind
import io.meld.sdk.requirements.MeldReadyHandle
import io.meld.sdk.requirements.MeldReadyHandlers
import io.meld.sdk.requirements.MeldReadyOpenStep
import io.meld.sdk.requirements.MeldReadyOptions
import io.meld.sdk.requirements.MeldReadyProvider
import io.meld.sdk.requirements.MeldReadyResult
import io.meld.sdk.requirements.MeldReadyStatus
import io.meld.sdk.requirements.MeldReadyStep
import io.meld.sdk.requirements.MeldRequirementsSession
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.math.BigDecimal

private const val SESSION = """{"id": "Hq4TzW8bNc3RvKx6YmPa2d", "customerId": "W9kL817BBS7bNEwxAZaX4z",
 "serviceProviders": ["UPHOLD"], "readyWhen": "ALL", "expiresAt": "2026-11-04T15:28:30Z",
 "token": "eyJhbGciOiJIUzI1NiJ9.fixture.requirements-session-token",
 "requirementsActions": {"version": 1, "endpoint": "/crypto/onramp/requirements-sessions/Hq4TzW8bNc3RvKx6YmPa2d/actions",
  "bearerTokenPointer": "/token", "operations": [{"operation": "READ", "idempotencyKeyRequired": false},
  {"operation": "RUN_STEP", "idempotencyKeyRequired": true}]}}"""

private const val SECRET = "synthetic-collected-value"

private class FakeHandle : MeldReadyHandle {
    var refreshed = 0
    var cancelled = 0
    override fun refresh() { refreshed++ }
    override fun cancel() { cancelled++ }
}

private class Harness(handlerNames: List<String>, options: String? = null) {
    val events = mutableListOf<Map<String, Any?>>()
    val bridge = MeldReadyBridge { events.add(it) }
    val handle = FakeHandle()
    var handlers: MeldReadyHandlers? = null
    var readyOptions: MeldReadyOptions? = null
    var onResult: ((MeldReadyResult) -> Unit)? = null

    init {
        val json = options ?: """{"handlers": [${handlerNames.joinToString { "\"$it\"" }}]}"""
        bridge.start("run", SESSION, json) { _, handlers, options, onResult ->
            this.handlers = handlers
            this.readyOptions = options
            this.onResult = onResult
            handle
        }
    }

    fun last(): Map<String, Any?> = events.last()

    @Suppress("UNCHECKED_CAST")
    fun payload(): Map<String, Any?> = last()["payload"] as Map<String, Any?>

    fun requestId(): String = last()["requestId"] as String
}

private val collectRequest = MeldCollectRequest(
    stepId = "*:CUSTOMER_DETAILS:CUSTOMER_NAME",
    type = "CUSTOMER_DETAILS",
    code = "CUSTOMER_NAME",
    serviceProviders = listOf("UPHOLD"),
    fields = listOf(MeldCollectField("name.firstName", label = "First name"), MeldCollectField("name.lastName")),
)

class MeldReadyEventTest {
    @Test
    fun `collected values reach the native run and never an event`() {
        val harness = Harness(listOf("collect"))
        val answers = mutableListOf<Map<String, String>?>()
        harness.handlers!!.collect!!(collectRequest) { answers.add(it) }
        assertEquals("collect", harness.last()["type"])
        assertEquals("run", harness.last()["handleId"])
        assertTrue(harness.bridge.respond("run", harness.requestId(), """{"values": {"name.firstName": "$SECRET", "name.lastName": "$SECRET"}}"""))
        assertEquals(listOf(mapOf("name.firstName" to SECRET, "name.lastName" to SECRET)), answers)

        val refused = collectRequest.copy(fieldErrors = listOf(MeldFieldError("name.lastName", "INVALID")))
        harness.handlers!!.collect!!(refused) { answers.add(it) }
        assertEquals(
            mapOf(
                "stepId" to "*:CUSTOMER_DETAILS:CUSTOMER_NAME", "type" to "CUSTOMER_DETAILS", "code" to "CUSTOMER_NAME",
                "serviceProviders" to listOf("UPHOLD"),
                "fields" to listOf(mapOf("key" to "name.firstName", "label" to "First name"), mapOf("key" to "name.lastName")),
                "fieldErrors" to listOf(mapOf("key" to "name.lastName", "reason" to "INVALID")),
            ),
            harness.payload(),
        )
        harness.onResult!!(
            MeldReadyResult(
                MeldReadyStatus.ACTION_REQUIRED, emptyList(),
                pending = listOf(MeldReadyStep("s", "COLLECT", "CUSTOMER_DETAILS", "CUSTOMER_NAME", listOf("UPHOLD"))),
            ),
        )
        assertEquals(listOf("collect", "collect", "result"), harness.events.map { it["type"] })
        assertFalse(harness.events.joinToString().contains(SECRET))
    }

    @Test
    fun `an unknown or already answered request id is ignored`() {
        val harness = Harness(listOf("confirmAgreement"))
        val answers = mutableListOf<Boolean>()
        harness.handlers!!.confirmAgreement!!(MeldAgreementRequest("s", "UPHOLD", "general-us")) { answers.add(it) }
        val requestId = harness.requestId()
        assertFalse(harness.bridge.respond("run", "999", """{"accepted": true}"""))
        assertFalse(harness.bridge.respond("other-run", requestId, """{"accepted": true}"""))
        assertTrue(answers.isEmpty())
        assertTrue(harness.bridge.respond("run", requestId, """{"accepted": true}"""))
        assertFalse(harness.bridge.respond("run", requestId, """{"accepted": false}"""))
        assertEquals(listOf(true), answers)
    }

    @Test
    fun `only a JSON true accepts terms and malformed answers decline`() {
        val harness = Harness(listOf("collect", "confirmAgreement"))
        val accepted = mutableListOf<Boolean>()
        for (json in listOf("""{"accepted": 1}""", """{"accepted": "true"}""", "{}", "not json")) {
            harness.handlers!!.confirmAgreement!!(MeldAgreementRequest("s", "P", "C")) { accepted.add(it) }
            harness.bridge.respond("run", harness.requestId(), json)
        }
        assertEquals(listOf(false, false, false, false), accepted)
        val values = mutableListOf<Map<String, String>?>()
        for (json in listOf("""{"values": null}""", """{"values": {"email": 1}}""", """{"values": ["email"]}""", "not json")) {
            harness.handlers!!.collect!!(collectRequest) { values.add(it) }
            harness.bridge.respond("run", harness.requestId(), json)
        }
        assertEquals(listOf<Map<String, String>?>(null, null, null, null), values)
    }

    @Test
    fun `only the handlers the app supplied reach the native run, with its timeout`() {
        val harness = Harness(emptyList(), """{"waitTimeoutMs": 30000, "handlers": ["confirmAgreement", 3]}""")
        val handlers = harness.handlers!!
        assertNotNull(handlers.confirmAgreement)
        assertNull(handlers.onProgress)
        assertNull(handlers.collect)
        assertNull(handlers.presentUrl)
        assertNull(handlers.renewSession)
        assertEquals(MeldReadyOptions(30_000), harness.readyOptions)
        assertEquals(MeldReadyOptions(600_000), Harness(emptyList(), "not json").readyOptions)
        assertEquals(MeldReadyOptions(600_000), Harness(emptyList(), """{"waitTimeoutMs": -1}""").readyOptions)
        assertEquals(MeldReadyOptions(Int.MAX_VALUE.toLong()), Harness(emptyList(), """{"waitTimeoutMs": 1e300}""").readyOptions)
    }

    @Test
    fun `a session this SDK cannot run, or no Activity, ends FAILED protocol without starting`() {
        for (session in listOf("not json", """{"id": "x"}""")) {
            val events = mutableListOf<Map<String, Any?>>()
            MeldReadyBridge { events.add(it) }.start("run", session, "{}") { _, _, _, _ -> error("must not start") }
            assertEquals(listOf(readyEvent("run", "result", protocolFailure())), events)
        }
        val events = mutableListOf<Map<String, Any?>>()
        val bridge = MeldReadyBridge { events.add(it) }
        bridge.start("run", SESSION, "{}") { _, _, _, _ -> null }
        assertEquals(listOf(readyEvent("run", "result", protocolFailure())), events)
        assertFalse(bridge.respond("run", "1", "{}"))
    }

    @Test
    fun `a run id is not started twice, and refresh, cancel and cancelAll reach the handle`() {
        val harness = Harness(emptyList())
        var started = 0
        harness.bridge.start("run", SESSION, "{}") { _, _, _, _ -> started++; null }
        assertEquals(0, started)
        harness.bridge.refresh("run")
        harness.bridge.cancel("run")
        harness.bridge.refresh("other-run")
        assertEquals(1, harness.handle.refreshed)
        assertEquals(1, harness.handle.cancelled)
        harness.bridge.cancelAll()
        assertEquals(2, harness.handle.cancelled)
        harness.bridge.cancel("run")
        assertEquals(2, harness.handle.cancelled)
    }

    @Test
    fun `the result ends the run, and later requests are not sent`() {
        val harness = Harness(listOf("presentUrl"))
        harness.onResult!!(MeldReadyResult(MeldReadyStatus.READY, emptyList()))
        assertEquals(
            readyEvent("run", "result", mapOf("status" to "READY", "providers" to emptyList<Any>(), "continuation" to emptyList<Any>())),
            harness.last(),
        )
        harness.handlers!!.presentUrl!!(MeldPresentUrlRequest("s", "https://example.test/kyc")) {}
        assertEquals(1, harness.events.size)
        harness.bridge.refresh("run")
        assertEquals(0, harness.handle.refreshed)
    }

    @Test
    fun `page, agreement and renewal requests`() {
        val harness = Harness(listOf("presentUrl", "confirmAgreement", "renewSession"))
        var closed = 0
        harness.handlers!!.presentUrl!!(MeldPresentUrlRequest("s", "https://example.test/kyc", "2026-11-04T15:28:30Z")) { closed++ }
        assertEquals(mapOf("stepId" to "s", "url" to "https://example.test/kyc", "expiresAt" to "2026-11-04T15:28:30Z"), harness.payload())
        harness.bridge.respond("run", harness.requestId(), "{}")
        assertEquals(1, closed)

        harness.handlers!!.confirmAgreement!!(MeldAgreementRequest("s", "UPHOLD", "general-us", "https://uphold.test/tos-us")) {}
        assertEquals(mapOf("stepId" to "s", "serviceProvider" to "UPHOLD", "code" to "general-us", "url" to "https://uphold.test/tos-us"), harness.payload())

        val renewed = mutableListOf<MeldRequirementsSession?>()
        harness.handlers!!.renewSession!! { renewed.add(it) }
        assertEquals("renewSession", harness.last()["type"])
        assertEquals(emptyMap<String, Any?>(), harness.payload())
        harness.bridge.respond("run", harness.requestId(), """{"session": $SESSION}""")
        harness.handlers!!.renewSession!! { renewed.add(it) }
        harness.bridge.respond("run", harness.requestId(), """{"session": {"id": "x"}}""")
        harness.handlers!!.renewSession!! { renewed.add(it) }
        harness.bridge.respond("run", harness.requestId(), """{"session": null}""")
        assertEquals(listOf("Hq4TzW8bNc3RvKx6YmPa2d", null, null), renewed.map { it?.id })
    }

    @Test
    fun `a result carries pending and error only when the run has them`() {
        val providers = listOf(
            MeldReadyProvider("BANXA", "ACTION_REQUIRED", false, listOf(MeldReadyOpenStep("MELD_KYC", "MELD_KYC", "REQUIRED"))),
            MeldReadyProvider("UPHOLD", "UNDETERMINED", null, emptyList()),
            MeldReadyProvider(
                "COINME", "BLOCKED", false,
                listOf(MeldReadyOpenStep("PROVIDER_KYC_SHARE", "PROVIDER_KYC_SHARE", "BLOCKED", "R", listOf("PHONE_VERIFICATION_REQUIRED"))),
            ),
        )
        val step = MeldReadyStep(
            "*:CUSTOMER_DETAILS:CUSTOMER_EMAIL", "COLLECT", "CUSTOMER_DETAILS", "CUSTOMER_EMAIL", listOf("UPHOLD"),
            fields = listOf(MeldCollectField("email", allowedValues = listOf("a"))), reason = "MISSING",
        )
        assertEquals(
            mapOf(
                "status" to "ACTION_REQUIRED",
                "providers" to listOf(
                    mapOf(
                        "serviceProvider" to "BANXA", "status" to "ACTION_REQUIRED", "eligible" to false,
                        "open" to listOf(mapOf("type" to "MELD_KYC", "code" to "MELD_KYC", "status" to "REQUIRED")),
                    ),
                    mapOf("serviceProvider" to "UPHOLD", "status" to "UNDETERMINED", "eligible" to null, "open" to emptyList<Any>()),
                    mapOf(
                        "serviceProvider" to "COINME", "status" to "BLOCKED", "eligible" to false,
                        "open" to listOf(
                            mapOf(
                                "type" to "PROVIDER_KYC_SHARE", "code" to "PROVIDER_KYC_SHARE", "status" to "BLOCKED", "reason" to "R",
                                "errorCodes" to listOf("PHONE_VERIFICATION_REQUIRED"),
                            ),
                        ),
                    ),
                ),
                "pending" to listOf(
                    mapOf(
                        "stepId" to "*:CUSTOMER_DETAILS:CUSTOMER_EMAIL", "kind" to "COLLECT", "type" to "CUSTOMER_DETAILS",
                        "code" to "CUSTOMER_EMAIL", "serviceProviders" to listOf("UPHOLD"),
                        "fields" to listOf(mapOf("key" to "email", "allowedValues" to listOf("a"))), "reason" to "MISSING",
                    ),
                ),
                "continuation" to listOf(mapOf("serviceProvider" to "STRIPE", "code" to "IDENTITY")),
            ),
            resultPayload(
                MeldReadyResult(
                    MeldReadyStatus.ACTION_REQUIRED, providers, listOf(step), listOf(MeldReadyContinuation("STRIPE", "IDENTITY")),
                ),
            ),
        )
        assertEquals(
            mapOf(
                "status" to "FAILED", "providers" to emptyList<Any>(), "continuation" to emptyList<Any>(),
                "error" to mapOf("kind" to "http", "status" to 403),
            ),
            resultPayload(MeldReadyResult(MeldReadyStatus.FAILED, emptyList(), error = MeldReadyError(MeldReadyErrorKind.HTTP, 403))),
        )
        assertEquals(
            mapOf(
                "stepId" to "s", "kind" to "OPEN_URL", "type" to "EXTERNAL_KYC", "code" to "NOAH", "serviceProviders" to listOf("NOAH"),
                "url" to "https://example.test/onboarding", "expiresAt" to "2026-11-04T15:28:30Z",
            ),
            stepPayload(
                MeldReadyStep("s", "OPEN_URL", "EXTERNAL_KYC", "NOAH", listOf("NOAH"), url = "https://example.test/onboarding", expiresAt = "2026-11-04T15:28:30Z"),
            ),
        )
    }

    @Test
    fun `progress carries the latest READ with numbers React Native can take`() {
        val snapshot = mapOf(
            "version" to 1, "pollAfterMs" to 4000L, "big" to 5_000_000_000L, "ratio" to BigDecimal("0.5"),
            "next" to listOf(mapOf("count" to BigDecimal("2"))), "eligible" to null,
        )
        assertEquals(
            mapOf(
                "state" to "WAITING",
                "snapshot" to mapOf(
                    "version" to 1, "pollAfterMs" to 4000, "big" to 5.0E9, "ratio" to 0.5, "next" to listOf(mapOf("count" to 2)),
                    "eligible" to null,
                ),
            ),
            progressPayload("WAITING", snapshot),
        )
        assertEquals(mapOf("state" to "READING", "snapshot" to null), progressPayload("READING", null))
    }
}
