#import "NSSqliteBridge.h"

#include "nssqlite.h"

/* Context of one request: the JS callback and the run loop to deliver on. Freed after done. */
@interface NSSqliteCall : NSObject
@property(nonatomic, copy) NSSqliteCallback callback;
@property(nonatomic, assign) CFRunLoopRef runLoop;
@end

@implementation NSSqliteCall
- (void)dealloc {
    if (_runLoop) CFRelease(_runLoop);
}
@end

static void nssqlite_deliver(void* user, NSResult r) {
    /* one reference per request: kept for streamed chunks, consumed by the final callback */
    NSSqliteCall* call = r.done ? (__bridge_transfer NSSqliteCall*)user : (__bridge NSSqliteCall*)user;
    int status = r.status;
    BOOL done = r.done != 0;
    NSData* data = r.data ? [NSData dataWithBytesNoCopy:r.data length:r.len freeWhenDone:YES] : nil;
    NSString* message = nil;
    if (r.message) {
        message = [NSString stringWithUTF8String:r.message];
        nssqlite_free(r.message);
    }
    int64_t changes = r.changes, rowid = r.last_insert_rowid;
    CFRunLoopRef rl = call.runLoop;
    CFRunLoopPerformBlock(rl, kCFRunLoopCommonModes, ^{
        call.callback(status, done, data, message, changes, rowid);
    });
    CFRunLoopWakeUp(rl);
}

static void* new_call(NSSqliteCallback cb) {
    NSSqliteCall* call = [NSSqliteCall new];
    call.callback = cb;
    call.runLoop = (CFRunLoopRef)CFRetain(CFRunLoopGetCurrent());
    return (__bridge_retained void*)call;
}

/* The core did not accept the request: its callback will not run, drop the context. */
static void drop_call(void* p) { (void)(__bridge_transfer NSSqliteCall*)p; }

static NSError* make_error(const char* msg) {
    return [NSError errorWithDomain:@"NSSqlite" code:1 userInfo:@{NSLocalizedDescriptionKey : [NSString stringWithUTF8String:msg]}];
}

@implementation NSSqliteBridge

+ (uint64_t)engine:(NSString*)library error:(NSError**)error {
    char err[256] = {0};
    NSEngine* e = nssqlite_engine(library ? library.UTF8String : NULL, err, sizeof(err));
    if (!e) {
        if (error) *error = make_error(err);
        return 0;
    }
    return (uint64_t)(uintptr_t)e;
}

+ (NSString*)engineVersion:(uint64_t)engine {
    return [NSString stringWithUTF8String:nssqlite_engine_version((NSEngine*)(uintptr_t)engine)];
}

+ (BOOL)engineCanLoadExtensions:(uint64_t)engine {
    return nssqlite_engine_can_load_extensions((NSEngine*)(uintptr_t)engine) != 0;
}

+ (int)engineAutoExtension:(uint64_t)engine initFn:(uint64_t)initFn {
    return nssqlite_engine_auto_extension((NSEngine*)(uintptr_t)engine, (void (*)(void))(uintptr_t)initFn);
}

+ (uint64_t)open:(uint64_t)engine path:(NSString*)path flags:(int)flags busyMs:(int)busyMs wal:(BOOL)wal initSql:(NSString*)initSql callback:(NSSqliteCallback)callback {
    NSOpenOptions o = {0};
    o.flags = flags;
    o.busy_timeout_ms = busyMs;
    o.wal = wal ? 1 : 0;
    o.init_sql = initSql.UTF8String;
    void* ctx = new_call(callback);
    NSDb* db = nssqlite_open((NSEngine*)(uintptr_t)engine, path.UTF8String, &o, nssqlite_deliver, ctx);
    if (!db) {
        drop_call(ctx);
        return 0;
    }
    return (uint64_t)(uintptr_t)db;
}

+ (void)releaseDb:(uint64_t)db {
    nssqlite_db_release((NSDb*)(uintptr_t)db);
}

+ (int)exec:(uint64_t)db tx:(int)tx sql:(NSString*)sql params:(NSData*)params flags:(int)flags chunkRows:(int)chunkRows callback:(NSSqliteCallback)callback {
    NSData* sqlBytes = [sql dataUsingEncoding:NSUTF8StringEncoding];
    void* ctx = new_call(callback);
    int rc = nssqlite_exec((NSDb*)(uintptr_t)db, (uint32_t)tx, (const char*)sqlBytes.bytes, sqlBytes.length, (const uint8_t*)params.bytes, params.length,
                           (uint32_t)flags, (uint32_t)chunkRows, nssqlite_deliver, ctx);
    if (rc) drop_call(ctx);
    return rc;
}

+ (int)batch:(uint64_t)db tx:(int)tx request:(NSData*)request flags:(int)flags callback:(NSSqliteCallback)callback {
    void* ctx = new_call(callback);
    int rc = nssqlite_batch((NSDb*)(uintptr_t)db, (uint32_t)tx, (const uint8_t*)request.bytes, request.length, (uint32_t)flags, nssqlite_deliver, ctx);
    if (rc) drop_call(ctx);
    return rc;
}

+ (int)txBegin:(uint64_t)db mode:(int)mode callback:(NSSqliteCallback)callback {
    void* ctx = new_call(callback);
    uint32_t id = nssqlite_tx_begin((NSDb*)(uintptr_t)db, mode, nssqlite_deliver, ctx);
    if (!id) drop_call(ctx);
    return (int)id;
}

+ (int)txEnd:(uint64_t)db tx:(int)tx commit:(BOOL)commit callback:(NSSqliteCallback)callback {
    void* ctx = new_call(callback);
    int rc = nssqlite_tx_end((NSDb*)(uintptr_t)db, (uint32_t)tx, commit ? 1 : 0, nssqlite_deliver, ctx);
    if (rc) drop_call(ctx);
    return rc;
}

+ (int)loadExtension:(uint64_t)db path:(NSString*)path entry:(NSString*)entry callback:(NSSqliteCallback)callback {
    void* ctx = new_call(callback);
    int rc = nssqlite_load_extension((NSDb*)(uintptr_t)db, path.UTF8String, entry.UTF8String, nssqlite_deliver, ctx);
    if (rc) drop_call(ctx);
    return rc;
}

+ (int)close:(uint64_t)db callback:(NSSqliteCallback)callback {
    void* ctx = new_call(callback);
    int rc = nssqlite_close((NSDb*)(uintptr_t)db, nssqlite_deliver, ctx);
    if (rc) drop_call(ctx);
    return rc;
}

@end
