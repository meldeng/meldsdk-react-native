#import <React/RCTBridgeModule.h>

// Registers native Apple Pay (Mercuryo NAP) as NativeModules.MeldApplePay.
@interface RCT_EXTERN_MODULE(MeldApplePay, NSObject)

RCT_EXTERN_METHOD(isAvailable:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(presentApplePay:(NSDictionary *)order
                  request:(NSDictionary *)request
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
