package io.meld.rn

import com.facebook.react.bridge.ReadableMap
import com.facebook.react.common.MapBuilder
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp

/**
 * Registers the [MeldWidgetView] with React Native under the component name "MeldWidget"
 * (matches `requireNativeComponent('MeldWidget')` in JS and the iOS view).
 */
class MeldWidgetViewManager : SimpleViewManager<MeldWidgetView>() {

    override fun getName() = "MeldWidget"

    override fun createViewInstance(reactContext: ThemedReactContext) = MeldWidgetView(reactContext)

    @ReactProp(name = "order")
    fun setOrder(view: MeldWidgetView, order: ReadableMap?) {
        view.setOrder(order)
    }

    override fun onDropViewInstance(view: MeldWidgetView) {
        view.unmount() // teardown when RN removes the component
        super.onDropViewInstance(view)
    }

    // Direct events the view emits -> the matching JS props on <MeldWidget>.
    override fun getExportedCustomDirectEventTypeConstants(): Map<String, Any> =
        MapBuilder.builder<String, Any>()
            .put("onReady", MapBuilder.of("registrationName", "onReady"))
            .put("onPaymentSubmitted", MapBuilder.of("registrationName", "onPaymentSubmitted"))
            .put("onStatusChange", MapBuilder.of("registrationName", "onStatusChange"))
            .put("onCancel", MapBuilder.of("registrationName", "onCancel"))
            .put("onError", MapBuilder.of("registrationName", "onError"))
            .build()
}
