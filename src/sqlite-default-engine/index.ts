/** Configures sqlite-core with androidx sqlite-bundled (Android) or the SQLite of the process (iOS). Import it once at startup. */
import { isAndroid } from '@nativescript/core';
import { configure } from '@nativescript-community/sqlite-core';

// WAL is off by default: switching an existing database to WAL breaks apps made before the `wal` option existed.
// Opt in per database with `{ wal: true }`, or for all with `configure({ defaultOptions: { wal: true } })`.
configure({ defaultEngine: isAndroid ? 'libsqliteJni.so' : null });
