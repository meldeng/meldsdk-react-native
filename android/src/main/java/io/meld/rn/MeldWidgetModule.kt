package io.meld.rn

import android.content.ActivityNotFoundException
import androidx.activity.ComponentActivity
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.bridge.WritableMap
import io.meld.sdk.Meld
import io.meld.sdk.MeldEnvironment
import io.meld.sdk.MeldErrorCode
import io.meld.sdk.MeldHeadlessPresentation
import io.meld.sdk.MeldOrder
import io.meld.sdk.MeldReadiness

/**
 * Exposes `Meld.configure`, `Meld.capabilities`, `Meld.presentationCapabilities`,
 * `Meld.paymentMethodReadiness`, `Meld.presentationReadiness`, `Meld.ensureReady` and
 * `Meld.openHostedVerification` to JS under
 * the native module name "MeldModule" (matches `NativeModules.MeldModule` and the iOS
 * `MeldModule`). Kept separate from the view manager so it's an unambiguous native module on both
 * architectures.
 */
class MeldWidgetModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    private val ready = MeldReadyBridge { event ->
        reactApplicationContext.emitDeviceEvent(READY_EVENT, Arguments.makeNativeMap(event))
    }

    override fun getName() = "MeldModule"

    override fun getConstants(): Map<String, Any> = mapOf("headlessProtocolVersion" to 1)

    @ReactMethod
    fun configure(environment: String) {
        Meld.configure(
            when (environment) {
                "production" -> MeldEnvironment.PRODUCTION
                "qa" -> MeldEnvironment.QA
                else -> MeldEnvironment.SANDBOX
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

    /** Advisory descriptor support from the installed adapter registry; no order or network request. */
    @ReactMethod
    fun presentationCapabilities(paymentMethodType: String, presentation: ReadableMap, promise: Promise) {
        val caps = descriptor(presentation)?.let { Meld.presentationCapabilities(it, paymentMethodType) }
        promise.resolve(
            Arguments.createMap().apply {
                putBoolean("embeddable", caps?.embeddable ?: false)
                putString("surface", caps?.surface ?: "unsupported")
                putBoolean("requiresUserGesture", caps?.requiresUserGesture ?: false)
            },
        )
    }

    /** Device readiness for a payment method before any quote, from the native SDK; no order or network request. */
    @ReactMethod
    fun paymentMethodReadiness(paymentMethodType: String, promise: Promise) {
        Meld.paymentMethodReadiness(reactApplicationContext, paymentMethodType) { readiness ->
            promise.resolve(readinessMap(readiness))
        }
    }

    /** Device readiness for a quote row's method, from the native SDK; no order or network request. */
    @ReactMethod
    fun presentationReadiness(paymentMethodType: String, presentation: ReadableMap, promise: Promise) {
        val descriptor = descriptor(presentation) ?: return promise.resolve(
            readinessMap(
                MeldReadiness.Unavailable(MeldErrorCode.PAYMENT_METHOD_UNAVAILABLE, "The headlessPresentation is malformed."),
            ),
        )
        Meld.presentationReadiness(reactApplicationContext, descriptor, paymentMethodType) { readiness ->
            promise.resolve(readinessMap(readiness))
        }
    }

    /** Runs a requirements session for JS; requests and the result arrive as `MeldReadyEvent`. */
    @ReactMethod
    fun ensureReady(handleId: String, sessionJson: String, optionsJson: String) {
        UiThreadUtil.runOnUiThread {
            ready.start(handleId, sessionJson, optionsJson) { session, handlers, options, onResult ->
                (reactApplicationContext.currentActivity as? ComponentActivity)?.let { activity ->
                    Meld.ensureReady(activity, session, handlers, options, onResult)
                }
            }
        }
    }

    /** The app's answer to one request. An unknown or already answered request is ignored. */
    @ReactMethod
    fun respond(handleId: String, requestId: String, json: String) {
        UiThreadUtil.runOnUiThread { ready.respond(handleId, requestId, json) }
    }

    @ReactMethod
    fun refresh(handleId: String) {
        UiThreadUtil.runOnUiThread { ready.refresh(handleId) }
    }

    @ReactMethod
    fun cancel(handleId: String) {
        UiThreadUtil.runOnUiThread { ready.cancel(handleId) }
    }

    /** Opens a hosted verification page in a Custom Tab; resolves once the customer is back. */
    @ReactMethod
    fun openHostedVerification(url: String, promise: Promise) {
        UiThreadUtil.runOnUiThread {
            val activity = reactApplicationContext.currentActivity as? ComponentActivity
                ?: return@runOnUiThread promise.reject("presentation_unavailable", "No Activity is on screen to open the page from.")
            try {
                Meld.openHostedVerification(activity, url) { promise.resolve(null) }
            } catch (e: IllegalArgumentException) {
                promise.reject("invalid_url", "openHostedVerification opens https pages only.")
            } catch (e: ActivityNotFoundException) {
                promise.reject("presentation_unavailable", "No app on this device can open the page.")
            }
        }
    }

    // NativeEventEmitter calls these; events go out through the device event emitter.
    @ReactMethod
    fun addListener(eventName: String) {}

    @ReactMethod
    fun removeListeners(count: Int) {}

    override fun invalidate() {
        UiThreadUtil.runOnUiThread { ready.cancelAll() }
        super.invalidate()
    }

    private fun descriptor(presentation: ReadableMap): MeldHeadlessPresentation? = runCatching {
        MeldOrder.fromMap(mapOf("headlessPresentation" to presentation.toHashMap())).headlessPresentation
    }.getOrNull()

    private fun readinessMap(readiness: MeldReadiness): WritableMap = Arguments.makeNativeMap(readinessEvent(readiness))
}
