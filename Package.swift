// swift-tools-version:5.9
import PackageDescription

// Tests the platform-independent state and input code also compiled into the React Native bridge.
// The example iOS build separately compiles the actual React/UIKit/MeldSDK integration.
let package = Package(name: "MeldBridgeSupport", targets: [
    .target(name: "MeldBridgeSupport", path: "ios",
            exclude: ["MeldModule.swift", "MeldModule.m", "MeldWidgetView.swift", "MeldWidgetManager.swift", "MeldWidgetManager.m"],
            sources: ["MeldMountLifecycle.swift", "MeldApplePayInput.swift"]),
    .testTarget(name: "MeldBridgeSupportTests", dependencies: ["MeldBridgeSupport"], path: "Tests/MeldBridgeSupportTests")
])
