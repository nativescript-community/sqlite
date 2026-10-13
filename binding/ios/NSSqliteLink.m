#import <Foundation/Foundation.h>

/* The addon lives in a static library. CocoaPods links static pods with -ObjC, which only pulls
 * in object files that define ObjC classes, so this class references the addon's registration
 * function to keep (and run) it. */
extern void nssqlite_napi_register(void);

@interface NSSqliteLink : NSObject
@end

@implementation NSSqliteLink
+ (void)load {
    nssqlite_napi_register();
}
@end
