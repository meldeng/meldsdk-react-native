package io.meld.rn

import io.meld.sdk.MeldError

/** The `onError` payload JS receives, built from plain values so it can be tested without React Native. */
internal fun errorEvent(e: MeldError): Map<String, Any> = buildMap {
    put("orderId", e.orderId ?: "")
    put("code", e.code)
    put("message", e.message)
    put("detail", e.detail ?: "")
    put("recoverable", e.recoverable)
    e.paymentMethodType?.takeIf { it.isNotEmpty() }?.let { put("paymentMethodType", it) }
}

/** The order prop's `paymentMethodType`, for the errors the bridge reports before or instead of a mount. */
internal fun paymentMethodTypeOf(order: Map<String, Any?>): String? =
    (order["paymentMethodType"] as? String)?.takeIf { it.isNotEmpty() }
