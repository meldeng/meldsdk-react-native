#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

// Registers the imperative Meld API (configure / capabilities / readiness / ensureReady) as NativeModules.MeldModule.
@interface RCT_EXTERN_MODULE(MeldModule, RCTEventEmitter)

RCT_EXTERN_METHOD(configure:(NSString *)environment)
RCT_EXTERN_METHOD(capabilities:(NSDictionary *)order
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(presentationCapabilities:(NSString *)paymentMethodType
                  presentation:(NSDictionary *)presentation
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(paymentMethodReadiness:(NSString *)paymentMethodType
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(presentationReadiness:(NSString *)paymentMethodType
                  presentation:(NSDictionary *)presentation
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(ensureReady:(NSString *)handleId
                  sessionJson:(NSString *)sessionJson
                  optionsJson:(NSString *)optionsJson)
RCT_EXTERN_METHOD(respond:(NSString *)handleId
                  requestId:(NSString *)requestId
                  json:(NSString *)json)
RCT_EXTERN_METHOD(refresh:(NSString *)handleId)
RCT_EXTERN_METHOD(cancel:(NSString *)handleId)
RCT_EXTERN_METHOD(openHostedVerification:(NSString *)url
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
