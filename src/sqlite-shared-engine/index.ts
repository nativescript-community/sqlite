/** Configures sqlite-core with the shared libsqlite.so (Android) or the SQLite of the process (iOS). Import it once at startup. */
import { isAndroid } from '@nativescript/core';
import { configure } from '@nativescript-community/sqlite-core';

export const SHARED_ENGINE = 'libsqlite.so';

// Android: WAL by default. With the DELETE journal every commit creates and syncs a file: 500 awaited writes took 2.6 s on a
// phone, 38 ms in WAL (`{ wal: false }` opts out).
configure({ defaultEngine: isAndroid ? SHARED_ENGINE : null, defaultOptions: isAndroid ? { wal: true } : undefined });
