#import <Foundation/Foundation.h>

/* The Node-API binding lives in a static library. The linker only keeps objects that are referenced, and
 * (CocoaPods and the NativeScript CLI link static libraries with -ObjC) only pulls in those defining ObjC
 * classes. This class references the registration function so the binding is always linked and registered
 * when the library loads. */
extern void nssqlite_napi_register(void);

@interface NSSqliteNapiLink : NSObject
@end

@implementation NSSqliteNapiLink
+ (void)load {
    nssqlite_napi_register();
}
@end
