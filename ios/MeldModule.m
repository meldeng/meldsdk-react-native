#import <React/RCTBridgeModule.h>

// Registers the imperative Meld API (configure / capabilities) as NativeModules.MeldModule.
@interface RCT_EXTERN_MODULE(MeldModule, NSObject)

RCT_EXTERN_METHOD(configure:(NSString *)environment)
RCT_EXTERN_METHOD(capabilities:(NSDictionary *)order
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(canPresentApplePay:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
