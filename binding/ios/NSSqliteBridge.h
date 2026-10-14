#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/* Called with the result of a request. status 0 = ok, > 0 SQLite code, < 0 core error.
 * For streaming requests the block is called once per chunk (done = NO) and a last time (done = YES).
 * data is a rows block / batch block (see core/nssqlite_wire.h) and owns its memory. */
typedef void (^NSSqliteCallback)(int status, BOOL done, NSData* _Nullable data, NSString* _Nullable message, int64_t changes, int64_t lastInsertRowId);

/*
 * Thin Objective-C bridge over the C core, used by runtimes without Node-API (NativeScript <= 8).
 * Handles are plain integers. Callbacks run on the run loop of the thread that made the call.
 * Submit methods return 0 when queued or a negative core error (the callback is not called then).
 */
@interface NSSqliteBridge : NSObject

/* library == nil: use the sqlite3 symbols already in the process. Returns 0 and sets error on failure. */
+ (uint64_t)engine:(nullable NSString*)library error:(NSError* _Nullable* _Nullable)error;
+ (NSString*)engineVersion:(uint64_t)engine;
+ (BOOL)engineCanLoadExtensions:(uint64_t)engine;
/* initFn: address of a statically linked extension entry point. Returns 0 on success. */
+ (int)engineAutoExtension:(uint64_t)engine initFn:(uint64_t)initFn;

/* Returns the database handle immediately, 0 on failure. The callback reports the open result. */
+ (uint64_t)open:(uint64_t)engine path:(NSString*)path flags:(int)flags busyMs:(int)busyMs wal:(BOOL)wal initSql:(nullable NSString*)initSql callback:(NSSqliteCallback)callback;
+ (void)releaseDb:(uint64_t)db;

+ (int)exec:(uint64_t)db tx:(int)tx sql:(NSString*)sql params:(nullable NSData*)params flags:(int)flags chunkRows:(int)chunkRows callback:(NSSqliteCallback)callback;
+ (int)batch:(uint64_t)db tx:(int)tx request:(NSData*)request flags:(int)flags callback:(NSSqliteCallback)callback;
/* Returns the transaction id, 0 on error. */
+ (int)txBegin:(uint64_t)db mode:(int)mode callback:(NSSqliteCallback)callback;
+ (int)txEnd:(uint64_t)db tx:(int)tx commit:(BOOL)commit callback:(NSSqliteCallback)callback;
+ (int)loadExtension:(uint64_t)db path:(NSString*)path entry:(nullable NSString*)entry callback:(NSSqliteCallback)callback;
+ (int)close:(uint64_t)db callback:(NSSqliteCallback)callback;

@end

NS_ASSUME_NONNULL_END
