# Migrating from 3.x to 4.0

4.0 replaces the internals of the plugin: one C core with its own worker threads, one TypeScript layer, and thin bindings
(Node-API, JNI, Objective-C). The public API keeps its names and shapes, so most code runs as it is. A few things changed
on purpose. This page lists them.

## Install

`@nativescript-community/sqlite` is still the package to install. It now brings four packages:

| package | what it is |
|---|---|
| `@nativescript-community/sqlite-core` | the TypeScript API and the native core. No SQLite library, no binding |
| `@nativescript-community/sqlite-napi` | the Node-API binding (NativeScript 9.1+) |
| `@nativescript-community/sqlite-bridge` | the JNI / Objective-C binding (NativeScript 8 and older, or when you want it) |
| `@nativescript-community/sqlite-default-engine` | the SQLite library: androidx `sqlite-bundled` on Android (WAL on), the SQLite of the process on iOS |

Which binding is used is chosen at run time: Node-API when the runtime has it, the bridge otherwise. Nothing to configure.

To bring your own SQLite (SQLCipher, extensions, a fixed version) or to keep the app small, depend on `sqlite-core` plus the
pieces you want instead of the umbrella. See the [core documentation](packages/sqlite-core/README.md).

* **Android:** the Android Gradle plugin is unchanged, but the SQLite is no longer the one of the phone: it is androidx
  `sqlite-bundled` (`libsqliteJni.so`), so the version is the same on every device. The whitelist of `native-api-usage.json`
  does not need `android.database.sqlite` classes any more.
* **iOS:** FMDB and the Podfile are gone. The plugin ships static xcframeworks (device, simulator, Mac Catalyst). iOS 13+.
* If your app uses a Node-API runtime that has **no threadsafe functions** (the QuickJS-ng Android runtime), the plugin polls
  for results from a timer while requests are in flight. Same API, nothing to do.

## Things that break

### 1. Some calls return promises now

```ts
// 3.x
const version = db.getVersion();
db.close();

// 4.0
const version = await db.getVersion();
await db.close();
```

`close()` and `getVersion()` are asynchronous: the work is done by the database thread. Calls that were already promises are
unchanged. `isOpen` is still a property.

### 2. The database opens in the background

`openOrCreate()` returns at once and no longer throws when the file cannot be opened (wrong path, wrong key, corrupt file).
The error comes from the first query, or from `await db.ready`. Wrap the first query, or await `db.ready`, where 3.x had a
`try/catch` around `openOrCreate`. `openOrCreateAsync()` resolves when the database is open.

### 3. `execute()` returns a result

`execute()` resolved to nothing (Android) in 3.x. It now resolves to `{ changes, lastInsertRowId }`.

```ts
const { changes, lastInsertRowId } = await db.execute('INSERT INTO t(v) VALUES (?)', [1]);
```

Code that ignored the result is not affected. Code that treats a returned value as an id deserves a look: `lastInsertRowId` is
the SQLite rowid, which is the primary key only for an `INTEGER PRIMARY KEY` column. (ORM adapters that read "the id of the
inserted row" from the result, kiss-orm for instance, must not hand that rowid back for a table whose primary key is another
column: return nothing and let the ORM use the attributes it inserted.)

### 4. Parameters are bound with their real types

3.x on Android turned every parameter into a string. 4.0 binds what you pass:

| you pass | 3.x (Android) | 4.0 |
|---|---|---|
| number | string | INTEGER or REAL |
| boolean | `'true'` / `'false'` | `1` / `0` |
| `Date` | `Date.toString()` | ISO 8601 string (`toISOString()`) |
| `bigint` | string | INTEGER (64 bit) |
| `ArrayBuffer`, typed array, `number[]` | BLOB | BLOB |
| `null`, `undefined` | NULL | NULL |

This is the right behaviour, but it changes results where your data relied on the string conversion. The typical case: comparing
a column **without** a declared type (or a TEXT column) with a number. `WHERE name = ?` with `5` used to match the text `'5'`;
now the integer 5 does not equal the text `'5'`. Declare column types (INTEGER, TEXT, REAL) or pass the value in the type the
column stores. A `Date` you stored with 3.x as `Date.toString()` text is still readable, but new dates are ISO strings.

Integers beyond 2^53 come back as numbers by default (like 3.x). Use `{ int64: 'auto' }` or `{ int64: 'bigint' }` to keep them
exact.

### 5. The native database objects are gone

Removed because there is no `android.database.sqlite.SQLiteDatabase` or `FMDatabase` under the plugin any more:

* `wrapDb(nativeDb)`, the `db.db` property, `SQLiteDatabase` constructed from a native object.
* The helpers `byteArrayToBuffer`, `arrayToNativeByteArray`, `paramToString`, `paramsToStringArray`, `throwError`.
* The `WorkersContext` Java class.

If you need the Android framework SQLite itself, use `@nativescript-community/sqlite-android-framework` (a prototype, see its
README): it runs `android.database.sqlite` as an engine of the new core.

### 6. Options that no longer do anything

They are accepted so your code compiles, and ignored:

* `threading: true` (the 3.x worker mode). Every query already runs on a native thread and the JS thread is never blocked
  by the database. Remove the option.
* `cursorWindowSize`, `cursorWindowName`. There is no cursor window with androidx or the iOS SQLite: rows of any size can be
  read (3.x could not read a row over 2 MB without `cursorWindowSize`).

### 7. Write-ahead logging is on by default on Android

New databases and existing ones opened by 4.0 switch to WAL. It makes writes much faster (500 separate inserts: seconds with
the rollback journal, tens of ms with WAL), but the data of a database lives in `name.db` **plus** `name.db-wal` until a
checkpoint. If your app **copies, exports or uploads the `.db` file**, either:

```ts
await db.execute('PRAGMA wal_checkpoint(TRUNCATE)'); // before copying the file
```

or open with `wal: false` (or `configure({ defaultOptions: { wal: false } })`). A read only database is never switched.

### 8. Errors are `SqliteError`

While a `transaction` runs, other calls made on the same `db` join it, as in 3.x; use the `tx` argument to be explicit.

Errors are `SqliteError` objects with `code`, `extendedCode` (the SQLite result codes, for instance 2067 for a unique
constraint) and the `sql`. Code that matched on the text of the 3.x error messages needs updating; `error.code` is stable.

## Things that are new (optional)

* `batch()`, `executeScript()`, `transaction()` with a `tx` argument and a mode, `openOrCreateAsync()`.
* `executeSync()`, `selectSync()`, `getSync()`... on Node-API runtimes (NativeScript 9.1+).
* `loadExtension()`, SQLCipher and any SQLite version (`engine`, `configure`), see the core documentation.
* `int64` modes, `busyTimeout`, `initSql`, `wal`.

## Checking your migration

1. Search your code for `.getVersion(`, `.close(`, `wrapDb`, `.db.`, `threading`, `cursorWindow`.
2. Search for `WHERE` clauses that compare an untyped column with a parameter, and for stored dates.
3. If the app copies the database file, handle WAL (point 7).
4. Run your tests on a device: both platforms, and an old and a new Android version if you support both.

TypeORM (`@nativescript-community/sqlite/typeorm`) and nano-sql (`@nativescript-community/sqlite/nanosql`) are kept.
