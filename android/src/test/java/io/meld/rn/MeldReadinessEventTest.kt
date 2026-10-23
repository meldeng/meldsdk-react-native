package io.meld.rn

import io.meld.sdk.MeldErrorCode
import io.meld.sdk.MeldReadiness
import org.junit.Assert.assertEquals
import org.junit.Test

class MeldReadinessEventTest {
    @Test
    fun `a readiness answer names its explanation reason`() {
        assertEquals(mapOf("status" to "ready"), readinessEvent(MeldReadiness.Ready))
        assertEquals(
            mapOf("status" to "unavailable", "code" to "PAYMENT_METHOD_UNAVAILABLE", "reason" to "No card."),
            readinessEvent(MeldReadiness.Unavailable(MeldErrorCode.PAYMENT_METHOD_UNAVAILABLE, "No card.")),
        )
        assertEquals(
            mapOf("status" to "unknown", "reason" to "No answer."),
            readinessEvent(MeldReadiness.Unknown("No answer.")),
        )
    }
}
