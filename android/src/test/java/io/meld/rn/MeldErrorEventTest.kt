package io.meld.rn

import io.meld.sdk.MeldError
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test

class MeldErrorEventTest {
    @Test
    fun `an error carries the order's payment method`() {
        val error = MeldError(
            orderId = "synthetic-order",
            code = "PAYMENT_METHOD_UNAVAILABLE",
            message = "Unavailable",
            recoverable = false,
            paymentMethodType = "GOOGLE_PAY",
        )
        assertEquals(
            mapOf(
                "orderId" to "synthetic-order",
                "code" to "PAYMENT_METHOD_UNAVAILABLE",
                "message" to "Unavailable",
                "detail" to "",
                "recoverable" to false,
                "paymentMethodType" to "GOOGLE_PAY",
            ),
            errorEvent(error),
        )
    }

    @Test
    fun `an error from an order with no payment method leaves it out`() {
        for (missing in listOf(null, "")) {
            val event = errorEvent(MeldError(null, "MOUNT_FAILED", "Failed", "x", false, missing))
            assertFalse(event.containsKey("paymentMethodType"))
            assertEquals("", event["orderId"])
            assertEquals("x", event["detail"])
        }
    }

    @Test
    fun `the bridge names the order prop's payment method only when it is a string`() {
        assertEquals("GOOGLE_PAY", paymentMethodTypeOf(hashMapOf("paymentMethodType" to "GOOGLE_PAY")))
        for (order in listOf(hashMapOf<String, Any?>(), hashMapOf("paymentMethodType" to ""),
            hashMapOf("paymentMethodType" to 1.0), hashMapOf("paymentMethodType" to null))) {
            assertNull(paymentMethodTypeOf(order))
        }
    }
}
