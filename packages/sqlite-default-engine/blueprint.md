{{ load:../../tools/readme/edit-warning.md }}
{{ template:title }}
{{ template:badges }}
{{ template:description }}

{{ template:toc }}

## What it is

The SQLite that [`@nativescript-community/sqlite`](../sqlite) uses by default, as a package of its own so you can combine it with only the bindings you need (for example NativeScript 9.1+ without the JNI / Objective-C bridges):

* **Android**: androidx `sqlite-bundled` (a recent SQLite with FTS5, JSON, RTREE, math functions, ~0.65 MB per ABI), added to your app by this package's `include.gradle`. Engine `libsqliteJni.so`.
* **iOS**: the SQLite of the process: the system SQLite, or the one your app links (e.g. a CocoaPods `SQLCipher`).
* **WAL on Android**: databases open with `wal: true` (see below).

It contains no native code of its own. Do not install it when you bring your own SQLite (SQLCipher, a custom build): then nothing from androidx is in your app.

## Installation

`ns plugin add @nativescript-community/sqlite-core @nativescript-community/sqlite-napi {{ pkg.name }}`

(`sqlite-napi` for NativeScript 9.1+; `sqlite-bridge` instead of, or next to it, for NativeScript 8.) Import the package once, before the first database is opened, for example in `app.ts`:

```typescript
import '@nativescript-community/sqlite-default-engine'; // configures the default engine and options of sqlite-core
import { openOrCreate } from '@nativescript-community/sqlite-core';

const db = openOrCreate('my.db'); // androidx on Android, the process SQLite on iOS
await db.execute('CREATE TABLE names (id INTEGER PRIMARY KEY, name TEXT)');
```

Without the import the core has no engine and throws "No SQLite engine chosen". It only sets `defaultEngine` and `defaultOptions`: `configure({ engine })` or the `engine` option of a database still pick another SQLite.

### WAL by default on Android

With SQLite's default journal every commit creates, syncs and deletes a journal file, which made 500 awaited one-statement writes take 2.6 s on a phone (38 ms in WAL). The package sets `defaultOptions: { wal: true }` on Android: it adds `-wal` / `-shm` files next to the database (`deleteDatabase` removes them). Opt out per database with `{ wal: false }`, or for all with `configure({ defaultOptions: { wal: false } })`. In-memory and read-only databases ignore it. iOS keeps SQLite's default.

### Extensions

The Android engine can load extensions (`db.canLoadExtensions()`), the system SQLite of iOS cannot; see the *Extensions* section of the [`sqlite-core`](../sqlite-core) documentation.
