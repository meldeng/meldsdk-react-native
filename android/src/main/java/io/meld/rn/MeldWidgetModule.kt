package io.meld.rn

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import io.meld.sdk.Meld
import io.meld.sdk.MeldEnvironment
import io.meld.sdk.MeldOrder

/**
 * Exposes `Meld.configure` and `Meld.capabilities` to JS under the native module name
 * "MeldModule" (matches `NativeModules.MeldModule` and the iOS `MeldModule`). Kept separate from
 * the view manager so it's an unambiguous native module on both architectures.
 */
class MeldWidgetModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "MeldModule"

    override fun getConstants(): Map<String, Any> = mapOf("headlessProtocolVersion" to 1)

    @ReactMethod
    fun configure(environment: String) {
        Meld.configure(
            when (environment) {
                "production" -> MeldEnvironment.PRODUCTION
                "sandbox" -> MeldEnvironment.SANDBOX
                else -> throw IllegalArgumentException("Unsupported Android Meld environment")
            },
        )
    }

    /** Inspect an order before rendering the widget — bridges to `Meld.capabilities(order)`. */
    @ReactMethod
    fun capabilities(order: ReadableMap, promise: Promise) {
        val parsed = try {
            MeldOrder.fromMap(order.toHashMap())
        } catch (e: Exception) {
            promise.reject("invalid_order", "Could not parse the order JSON", e)
            return
        }
        val caps = Meld.capabilities(parsed)
        promise.resolve(
            Arguments.createMap().apply {
                putBoolean("embeddable", caps.embeddable)
                putString("surface", caps.surface)
                putBoolean("requiresUserGesture", caps.requiresUserGesture)
            },
        )
    }
    /** Decode with the native SDK, preserving the same strict version rules as actual orders. */
    @ReactMethod
    fun presentationCapabilities(paymentMethodType: String, presentation: ReadableMap, promise: Promise) {
        val descriptor = try {
            MeldOrder.fromMap(mapOf("headlessPresentation" to presentation.toHashMap())).headlessPresentation
        } catch (_: Exception) {
            null
        }
        val caps = descriptor?.let { Meld.presentationCapabilities(it, paymentMethodType) }
        promise.resolve(Arguments.createMap().apply {
            putBoolean("embeddable", caps?.embeddable ?: false)
            putString("surface", caps?.surface ?: "unsupported")
            putBoolean("requiresUserGesture", caps?.requiresUserGesture ?: false)
        })
    }

}
