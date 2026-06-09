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
 * "MeldWidgetManager" (matches `NativeModules.MeldWidgetManager` and the iOS manager).
 */
class MeldWidgetModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "MeldWidgetManager"

    @ReactMethod
    fun configure(environment: String) {
        Meld.configure(
            if (environment == "production") MeldEnvironment.PRODUCTION else MeldEnvironment.SANDBOX,
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
}
