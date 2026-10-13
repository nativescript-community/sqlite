#include "provider.h"

#include <dlfcn.h>
#include <stdio.h>
#include <string.h>

static void set_err(char* err, size_t errlen, const char* fmt, const char* a) {
    if (err && errlen) {
        snprintf(err, errlen, fmt, a ? a : "");
    }
}

int nssqlite_provider_load(NSSqliteProvider* p, const char* path, char* err, size_t errlen) {
    memset(p, 0, sizeof(*p));
    void* h = path ? dlopen(path, RTLD_NOW | RTLD_LOCAL) : RTLD_DEFAULT;
    if (!h) {
        set_err(err, errlen, "dlopen failed: %s", dlerror());
        return 1;
    }
    p->handle = path ? h : NULL;

#define REQ(field, name)                                         \
    do {                                                         \
        *(void**)(&p->field) = dlsym(h, name);                   \
        if (!p->field) {                                         \
            set_err(err, errlen, "missing symbol %s", name);     \
            nssqlite_provider_unload(p);                         \
            return 2;                                            \
        }                                                        \
    } while (0)
#define OPT(field, name) *(void**)(&p->field) = dlsym(h, name)

    REQ(libversion, "sqlite3_libversion");
    REQ(threadsafe, "sqlite3_threadsafe");
    REQ(open_v2, "sqlite3_open_v2");
    REQ(close_v2, "sqlite3_close_v2");
    REQ(prepare_v3, "sqlite3_prepare_v3");
    REQ(step, "sqlite3_step");
    REQ(reset, "sqlite3_reset");
    REQ(finalize, "sqlite3_finalize");
    REQ(clear_bindings, "sqlite3_clear_bindings");
    REQ(bind_null, "sqlite3_bind_null");
    REQ(bind_int64, "sqlite3_bind_int64");
    REQ(bind_double, "sqlite3_bind_double");
    REQ(bind_text, "sqlite3_bind_text");
    REQ(bind_blob, "sqlite3_bind_blob");
    REQ(bind_parameter_count, "sqlite3_bind_parameter_count");
    REQ(column_count, "sqlite3_column_count");
    REQ(column_name, "sqlite3_column_name");
    REQ(column_type, "sqlite3_column_type");
    REQ(column_int64, "sqlite3_column_int64");
    REQ(column_double, "sqlite3_column_double");
    REQ(column_text, "sqlite3_column_text");
    REQ(column_blob, "sqlite3_column_blob");
    REQ(column_bytes, "sqlite3_column_bytes");
    REQ(changes, "sqlite3_changes");
    REQ(last_insert_rowid, "sqlite3_last_insert_rowid");
    REQ(busy_timeout, "sqlite3_busy_timeout");
    REQ(extended_errcode, "sqlite3_extended_errcode");
    REQ(errmsg, "sqlite3_errmsg");
    REQ(exec, "sqlite3_exec");
    REQ(free, "sqlite3_free");
    OPT(auto_extension, "sqlite3_auto_extension");
    OPT(load_extension, "sqlite3_load_extension");
    OPT(enable_load_extension, "sqlite3_enable_load_extension");
#undef REQ
#undef OPT

    if (p->threadsafe() == 0) {
        set_err(err, errlen, "%s", "provider SQLite was built with SQLITE_THREADSAFE=0");
        nssqlite_provider_unload(p);
        return 3;
    }
    return 0;
}

void nssqlite_provider_unload(NSSqliteProvider* p) {
    if (p->handle) {
        dlclose(p->handle);
    }
    memset(p, 0, sizeof(*p));
}
