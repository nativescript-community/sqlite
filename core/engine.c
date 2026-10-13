#include <pthread.h>
#include <stdlib.h>
#include <string.h>

#include "internal.h"

static pthread_mutex_t g_engines_mu = PTHREAD_MUTEX_INITIALIZER;
static NSEngine* g_engines = NULL;

static void set_err(char* err, size_t errlen, const char* msg) {
    if (err && errlen) {
        strncpy(err, msg, errlen - 1);
        err[errlen - 1] = 0;
    }
}

/* providers registered by name (statically linked SQLite), looked up before any dlopen */
static NSEngine* g_registered = NULL;

int nssqlite_register_provider(const char* name, const NSSqliteProvider* p) {
    if (!name || !p || !p->libversion || !p->open_v2 || !p->step || !p->prepare_v3 || !p->finalize || !p->close_v2) return NS_ERR_UNSUPPORTED;
    if (p->threadsafe && p->threadsafe() == 0) return NS_ERR_UNSUPPORTED;
    pthread_mutex_lock(&g_engines_mu);
    for (NSEngine* e = g_registered; e; e = e->next) {
        if (strcmp(e->name, name) == 0) {
            pthread_mutex_unlock(&g_engines_mu);
            return 0; /* already registered (several glue files, or a second load) */
        }
    }
    NSEngine* e = (NSEngine*)calloc(1, sizeof(*e));
    if (!e) {
        pthread_mutex_unlock(&g_engines_mu);
        return NS_ERR_NOMEM;
    }
    e->p = *p;
    e->name = strdup(name);
    e->next = g_registered;
    g_registered = e;
    pthread_mutex_unlock(&g_engines_mu);
    return 0;
}

NSEngine* nssqlite_engine(const char* library, char* err, size_t errlen) {
    pthread_mutex_lock(&g_engines_mu);
    for (NSEngine* e = g_engines; e; e = e->next) {
        if ((!library && !e->name) || (library && e->name && strcmp(library, e->name) == 0)) {
            pthread_mutex_unlock(&g_engines_mu);
            return e;
        }
    }
    if (library) {
        for (NSEngine* r = g_registered; r; r = r->next) {
            if (strcmp(r->name, library) == 0) {
                pthread_mutex_unlock(&g_engines_mu);
                return r;
            }
        }
    }
    NSEngine* e = (NSEngine*)calloc(1, sizeof(*e));
    if (!e) {
        pthread_mutex_unlock(&g_engines_mu);
        set_err(err, errlen, "out of memory");
        return NULL;
    }
    if (library) {
        e->name = strdup(library);
    }
    if (nssqlite_provider_load(&e->p, library, err, errlen)) {
        free(e->name);
        free(e);
        pthread_mutex_unlock(&g_engines_mu);
        return NULL;
    }
    e->next = g_engines;
    g_engines = e;
    pthread_mutex_unlock(&g_engines_mu);
    return e;
}

const char* nssqlite_engine_version(const NSEngine* e) { return e->p.libversion(); }

int nssqlite_engine_can_load_extensions(const NSEngine* e) { return e->p.enable_load_extension != NULL && e->p.load_extension != NULL; }

int nssqlite_engine_auto_extension(NSEngine* e, void (*init)(void)) {
    if (!e->p.auto_extension) return NS_ERR_UNSUPPORTED;
    return e->p.auto_extension(init);
}
