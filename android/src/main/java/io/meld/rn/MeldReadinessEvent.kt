package io.meld.rn

import io.meld.sdk.MeldReadiness

/** The readiness answer JS receives, built from plain values so it can be tested without React Native. */
internal fun readinessEvent(readiness: MeldReadiness): Map<String, Any> = when (readiness) {
    MeldReadiness.Ready -> mapOf("status" to "ready")
    is MeldReadiness.Unavailable -> mapOf("status" to "unavailable", "code" to readiness.code.raw, "reason" to readiness.reason)
    is MeldReadiness.Unknown -> mapOf("status" to "unknown", "reason" to readiness.reason)
}
