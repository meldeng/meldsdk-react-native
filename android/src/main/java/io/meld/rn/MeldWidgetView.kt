package io.meld.rn

import android.widget.FrameLayout
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.events.RCTEventEmitter
import io.meld.sdk.Meld
import io.meld.sdk.MeldError
import io.meld.sdk.MeldEventHandlers
import io.meld.sdk.MeldOrder
import io.meld.sdk.MeldWidgetHandle

/**
 * A view that hosts the Meld widget and forwards the SDK's events as React Native events. Thin
 * pass-through — all SDK logic stays in MeldSDK. Mirrors the iOS `MeldWidgetView`.
 */
class MeldWidgetView(private val reactContext: ThemedReactContext) : FrameLayout(reactContext) {

    // Callbacks from a mount that was replaced or unmounted are dropped (parity with iOS: the
    // handlers capture this view strongly, so a stray event after teardown must be a no-op).
    private val lifecycle = MeldMountLifecycle<MeldWidgetHandle> { it.unmount() }

    /** The order JSON from JS. A different order ends the current mount and mounts the new one. */
    fun setOrder(order: ReadableMap?) {
        if (order == null) return lifecycle.detach()
        val inputs = order.toHashMap()
        val paymentMethodType = paymentMethodTypeOf(inputs)

        // Parse failures must not be swallowed — surface them through onError so JS can react
        // instead of staring at a blank view. They are remembered like any failed attempt.
        val parsed: MeldOrder = try {
            MeldOrder.fromMap(inputs)
        } catch (e: Exception) {
            lifecycle.mount(inputs, { throw e }, { generation, _ ->
                emitError(generation, "INVALID_ORDER", "Could not parse the order JSON: ${e.message}", paymentMethodType)
            })
            return
        }

        val embeddable = Meld.capabilities(parsed).embeddable
        lifecycle.mount(inputs, { generation ->
            val handlers = handlers(generation)
            mountWhere(
                embeddable,
                reactContext.currentActivity,
                { Meld.mount(parsed, this, handlers) },
                { activity -> Meld.mount(parsed, activity, handlers) },
            )
        }, { generation, e ->
            // Mount failures (unsupported order, missing widget URL) also surface via onError.
            emitError(generation, "MOUNT_FAILED", e.message ?: "mount failed", paymentMethodType)
        })
    }

    /** Tear down when RN drops the view (see MeldWidgetViewManager.onDropViewInstance). */
    fun unmount() {
        lifecycle.detach()
    }

    private fun handlers(generation: Long) = MeldEventHandlers(
        onReady = { id -> emit(generation, "onReady", orderIdMap(id)) },
        onPaymentSubmitted = { id -> emit(generation, "onPaymentSubmitted", orderIdMap(id)) },
        onStatusChange = { e ->
            val payload = Arguments.createMap().apply {
                putString("orderId", e.orderId ?: "")
                putString("status", e.status.raw)
                putString("providerStatus", e.providerStatus ?: "")
            }
            // Forward the raw provider payload when it's a JSON-serializable map, for
            // parity with iOS (which guards with JSONSerialization.isValidJSONObject).
            // Non-string keys / non-bridgeable values would throw in makeNativeMap and
            // break event emission, so drop raw on failure rather than crash.
            (e.raw as? Map<*, *>)?.let { rawMap ->
                try {
                    @Suppress("UNCHECKED_CAST")
                    payload.putMap("raw", Arguments.makeNativeMap(rawMap as Map<String, Any?>))
                } catch (ignored: Exception) {
                    // raw not bridge-serializable — omit it, same as iOS
                }
            }
            emit(generation, "onStatusChange", payload)
        },
        onCancel = { id -> emit(generation, "onCancel", orderIdMap(id)) },
        onError = { e -> emit(generation, "onError", errorMap(e)) },
    )

    private fun emit(generation: Long, name: String, payload: WritableMap) {
        // Ignore callbacks from a replaced or torn-down mount. We deliberately do NOT gate on
        // id == NO_ID: the first INVALID_ORDER/MOUNT_FAILED can be emitted synchronously during
        // prop-set, and dropping it would reintroduce the silent blank-view failure.
        if (!lifecycle.isCurrent(generation)) return
        reactContext.getJSModule(RCTEventEmitter::class.java).receiveEvent(id, name, payload)
    }

    private fun emitError(generation: Long, code: String, message: String, paymentMethodType: String?) {
        val error = MeldError(orderId = null, code = code, message = message, recoverable = false, paymentMethodType = paymentMethodType)
        emit(generation, "onError", errorMap(error))
    }

    private fun orderIdMap(id: String?): WritableMap =
        Arguments.createMap().apply { putString("orderId", id ?: "") }

    private fun errorMap(e: MeldError): WritableMap = Arguments.makeNativeMap(errorEvent(e))
}
