import React
import MeldSDK

/// Registers the widget view with React Native (component name "MeldWidget"). The imperative API
/// (configure / capabilities) lives in `MeldModule` so it resolves as a plain native module on
/// both architectures, rather than hanging off this view manager.
@objc(MeldWidgetManager)
final class MeldWidgetManager: RCTViewManager {
    override func view() -> UIView! { MeldWidgetView() }
    override static func requiresMainQueueSetup() -> Bool { true }
}
