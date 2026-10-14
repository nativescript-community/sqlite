#ifndef NSSQLITE_INTERNAL_H
#define NSSQLITE_INTERNAL_H

#include <pthread.h>
#include <stdatomic.h>

#include "nssqlite.h"
#include "nssqlite_wire.h"
#include "provider.h"

struct NSEngine {
    NSSqliteProvider p;
    char* name; /* NULL = process symbols */
    NSEngine* next;
};

#endif
