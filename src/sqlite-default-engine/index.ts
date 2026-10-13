/**
 * The default SQLite engine for @nativescript-community/sqlite-core: androidx sqlite-bundled on Android (added by this
 * package's include.gradle), the SQLite of the process on iOS (the system one unless the app links another).
 * Import it once at startup (`import '@nativescript-community/sqlite-default-engine'`): it only configures the core.
 * Apps that choose their own SQLite do not install it and bring nothing they would have to remove.
 */
import { isAndroid } from '@nativescript/core';
import { configure } from '@nativescript-community/sqlite-core';

// Android: write-ahead logging by default. With the journal modes of SQLite's default (DELETE) every commit creates, syncs and
// deletes a journal file: 500 awaited one-statement writes took 2.6 s on a phone, 38 ms in WAL (`{ wal: false }` opts out).
configure({ defaultEngine: isAndroid ? 'libsqliteJni.so' : null, defaultOptions: isAndroid ? { wal: true } : undefined });
