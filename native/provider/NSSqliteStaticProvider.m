/* Glue for a SQLite that is linked statically into the app (a .a, a pod built as a static library, sources compiled
 * into the app target): build it into the same static library as the SQLite, next to sqlite3.c.
 *
 * Why: symbols of a static library are not visible to dlsym, which is how the plugin finds a SQLite otherwise. This file
 * references sqlite3_* directly (so the linker pulls the right SQLite in, whatever else defines the same names) and
 * registers them with the plugin at startup. The app then opens databases with `engine: '@static'`
 * (override the name with -DNSSQLITE_PROVIDER_NAME='"@mysqlite"').
 *
 * Needs: sqlite3.h of your SQLite, core/provider.h and core/nssqlite.h of the plugin (shipped in NSSqlite.xcframework). */
#import <Foundation/Foundation.h>

#include <sqlite3.h>

#include "nssqlite.h"
#include "provider.h"

#ifndef NSSQLITE_PROVIDER_NAME
#define NSSQLITE_PROVIDER_NAME "@static"
#endif

#define SET(field, fn) (*(void**)(&p.field) = (void*)(fn))

@interface NSSqliteStaticProviderLink : NSObject
@end

@implementation NSSqliteStaticProviderLink
+ (void)load {
    NSSqliteProvider p;
    memset(&p, 0, sizeof(p));
    SET(libversion, sqlite3_libversion);
    SET(threadsafe, sqlite3_threadsafe);
    SET(open_v2, sqlite3_open_v2);
    SET(close_v2, sqlite3_close_v2);
    SET(prepare_v3, sqlite3_prepare_v3);
    SET(step, sqlite3_step);
    SET(reset, sqlite3_reset);
    SET(finalize, sqlite3_finalize);
    SET(clear_bindings, sqlite3_clear_bindings);
    SET(bind_null, sqlite3_bind_null);
    SET(bind_int64, sqlite3_bind_int64);
    SET(bind_double, sqlite3_bind_double);
    SET(bind_text, sqlite3_bind_text);
    SET(bind_blob, sqlite3_bind_blob);
    SET(bind_parameter_count, sqlite3_bind_parameter_count);
    SET(column_count, sqlite3_column_count);
    SET(column_name, sqlite3_column_name);
    SET(column_type, sqlite3_column_type);
    SET(column_int64, sqlite3_column_int64);
    SET(column_double, sqlite3_column_double);
    SET(column_text, sqlite3_column_text);
    SET(column_blob, sqlite3_column_blob);
    SET(column_bytes, sqlite3_column_bytes);
    SET(changes, sqlite3_changes);
    SET(last_insert_rowid, sqlite3_last_insert_rowid);
    SET(busy_timeout, sqlite3_busy_timeout);
    SET(extended_errcode, sqlite3_extended_errcode);
    SET(errmsg, sqlite3_errmsg);
    SET(exec, sqlite3_exec);
    SET(free, sqlite3_free);
    SET(auto_extension, sqlite3_auto_extension);
#ifndef SQLITE_OMIT_LOAD_EXTENSION
    SET(load_extension, sqlite3_load_extension);
    SET(enable_load_extension, sqlite3_enable_load_extension);
#endif
    nssqlite_register_provider(NSSQLITE_PROVIDER_NAME, &p);
}
@end
