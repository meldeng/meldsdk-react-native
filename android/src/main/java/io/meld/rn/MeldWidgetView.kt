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

    private var handle: MeldWidgetHandle? = null
    private var order: ReadableMap? = null

    /** The order JSON from JS. Mount once it arrives. */
    fun setOrder(order: ReadableMap?) {
        this.order = order
        mountIfNeeded()
    }

    private fun mountIfNeeded() {
        if (handle != null) return
        val order = order ?: return

        // Parse failures must not be swallowed — surface them through onError so JS can react
        // instead of staring at a blank view.
        val parsed: MeldOrder = try {
            MeldOrder.fromMap(order.toHashMap())
        } catch (e: Exception) {
            emitError("INVALID_ORDER", "Could not parse the order JSON: ${e.message}")
            return
        }

        try {
            handle = Meld.mount(
                parsed,
                this,
                MeldEventHandlers(
                    onReady = { id -> emit("onReady", orderIdMap(id)) },
                    onPaymentSubmitted = { id -> emit("onPaymentSubmitted", orderIdMap(id)) },
                    onStatusChange = { e ->
                        val payload = Arguments.createMap().apply {
                            putString("orderId", e.orderId ?: "")
                            putString("status", e.status.raw)
                            putString("providerStatus", e.providerStatus ?: "")
                        }
                        // Forward the raw provider payload when it's a map, for parity with native.
                        (e.raw as? Map<*, *>)?.let {
                            @Suppress("UNCHECKED_CAST")
                            payload.putMap("raw", Arguments.makeNativeMap(it as Map<String, Any?>))
                        }
                        emit("onStatusChange", payload)
                    },
                    onCancel = { id -> emit("onCancel", orderIdMap(id)) },
                    onError = { e -> emit("onError", errorMap(e)) },
                ),
            )
        } catch (e: Exception) {
            // Mount failures (unsupported order, missing widget URL) also surface via onError.
            emitError("MOUNT_FAILED", e.message ?: "mount failed")
        }
    }

    /** Tear down when RN drops the view (see MeldWidgetViewManager.onDropViewInstance). */
    fun unmount() {
        handle?.unmount()
        handle = null
    }

    private fun emit(name: String, payload: WritableMap) {
        reactContext.getJSModule(RCTEventEmitter::class.java).receiveEvent(id, name, payload)
    }

    private fun emitError(code: String, message: String) {
        emit("onError", errorMap(MeldError(orderId = null, code = code, message = message, recoverable = false)))
    }

    private fun orderIdMap(id: String?): WritableMap =
        Arguments.createMap().apply { putString("orderId", id ?: "") }

    private fun errorMap(e: MeldError): WritableMap =
        Arguments.createMap().apply {
            putString("orderId", e.orderId ?: "")
            putString("code", e.code)
            putString("message", e.message)
            putString("detail", e.detail ?: "")
            putBoolean("recoverable", e.recoverable)
        }
}
