/**
 * The ready-to-use setup: @nativescript-community/sqlite-core (the API and the native core, no SQLite) plus a default
 * SQLite engine. On Android the engine is androidx sqlite-bundled (added by this package's include.gradle), on iOS the
 * SQLite of the process (the system one unless the app links another). Apps that choose their own SQLite depend on
 * @nativescript-community/sqlite-core directly and bring nothing they would have to remove.
 */
import { isAndroid } from '@nativescript/core';
import { configure } from '@nativescript-community/sqlite-core';

// Android: write-ahead logging by default. With the journal modes of SQLite's default (DELETE) every commit creates, syncs and
// deletes a journal file: 500 awaited one-statement writes took 2.6 s on a phone, 38 ms in WAL (`{ wal: false }` opts out).
configure({ defaultEngine: isAndroid ? 'libsqliteJni.so' : null, defaultOptions: isAndroid ? { wal: true } : undefined });

export * from '@nativescript-community/sqlite-core';
