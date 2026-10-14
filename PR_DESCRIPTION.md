## feat!: native core, one TypeScript layer, thin bindings (4.0)

Replaces the internals of the plugin. The public API keeps its names and shapes (`openOrCreate`, `execute`, `select`, `get`,
`each`, `transaction`, TypeORM, nano-sql), so basic code runs as written; the breaking points are listed in
[MIGRATION.md](MIGRATION.md).

### What it is

* **One C core** (`core/`): one worker thread and one connection per database, FIFO queue with transaction pinning, atomic
  batches, statement cache, a binary wire format for params and rows.
* **One TypeScript layer** (`src/sqlite`): the API, the codec, errors. Same code on every platform and runtime.
* **Thin bindings**: Node-API (NativeScript 9.1+, resolved at run time with `dlsym`, so it loads on any runtime), JNI and
  Objective-C (NativeScript 8 and older). The Node-API binding also works on runtimes **without threadsafe functions** (the
  QuickJS-ng Android runtime) through a polling mode, and converts long strings natively where there is no `TextDecoder`.
* **The app chooses the SQLite**: the core loads any `sqlite3_*` library (`dlopen`, or a statically linked one on iOS). The
  default is androidx `sqlite-bundled` (WAL on) on Android and the process SQLite on iOS. Extensions, SQLCipher and custom
  builds are supported.

### Packages

| package | role |
|---|---|
| `@nativescript-community/sqlite` | umbrella: everything below, no setup |
| `sqlite-core` | TypeScript API + native core, no SQLite library, no binding |
| `sqlite-napi` | Node-API binding |
| `sqlite-bridge` | JNI / Objective-C binding |
| `sqlite-default-engine` | androidx sqlite-bundled (Android) / process SQLite (iOS) |
| `sqlite-android-framework` | prototype: `android.database.sqlite` as an engine (configurable cursor window, default 16 MB) |

### Breaking changes (major)

`close()` / `getVersion()` are async; `execute()` resolves to `{ changes, lastInsertRowId }`; the database opens in the
background; parameters keep their types instead of becoming strings; `wrapDb`, `db.db` and the Android/iOS native helpers
are removed; `threading` / `cursorWindow*` are ignored; Android moves from the platform SQLite to androidx bundled, with WAL
on by default; FMDB is gone; minimum NativeScript 8. The 3.x README sample (nothing awaited, a synchronous `transaction`
callback) works as written, and the Android-only `flags` of 3.x are translated. **Read [MIGRATION.md](MIGRATION.md).**

### Performance (same workloads, 3.5.9 against this branch)

Android emulator, QuickJS-ng runtime (the hardest case for this branch: no threadsafe functions), warm, ms:

| | 3.5.9 | this branch |
|---|---|---|
| 500 inserts, autocommit | 4412 | 38 |
| select 20 000 rows × 3 | 242 | 15 |
| select 1000 rows with 2 KB blobs | 739 | 3.5 |
| select a 9.5 MB route row (3 text columns) | 69 (needs a 32 MB cursor window, fails at the default 2 MB) | 30 |
| longest JS-thread stall, select of 100 000 rows | 1833 | 80 |
| 5000 inserts in a transaction, awaited one by one | 105 | 134 |

The one workload where 3.5.9 stays ahead is a long loop of awaited tiny statements (it runs synchronously on the JS thread);
`batch()` and the `*Sync` calls cover it. More in `spike/perf/`.

### Testing

* C core: host tests with ASan/UBSan and TSan (`core/tests`).
* TypeScript against the real core through Node-API: 74 tests (`native/test-ts.sh`), also with `NSSQLITE_NO_TSFN=1` (polling
  mode); TypeORM: 17 (`native/test-orm.sh`).
* Devices: Android emulator and phone (both bindings), iOS simulator, extension / SQLCipher / static-provider tests, the
  framework engine suite. Mac Catalyst and the QuickJS-ng runtime verified in AlpiMaps (Android emulator), where the sqlite
  packages replaced 3.5.9.
* The device suites were re-run after the last TypeScript changes (Android emulator: API 13/13 per binding, TypeORM 8/8, engines
  28/28; iOS simulator: 13/13 per binding, 8/8, 2/2).
* **Not covered:** nano-sql tests; an iOS NativeScript 8 app with the split packages.

### Code style

The TypeScript/JavaScript of the branch follows: no single-letter names, no `as` casts or `!` assertions, comments short and
only where the code is not obvious. The C and Java sources were not part of that pass.

### Release

* The commit history carries a `BREAKING CHANGE:` footer, so `lerna publish` (auto) computes the major bump itself; versions
  are left at 3.5.9 and changelogs are generated at release.
* The prebuilt libraries (`jniLibs`, xcframeworks) are not in git. `npm run build.native` (`native/build-all.sh`) builds them:
  Android needs the NDK, iOS needs macOS. `build.all`, which `npm run publish` runs, calls it when the script exists.
* `release.yml` and the `build.all` script come from `tools`: [plugin-seed-tools#5](https://github.com/nativescript-community/plugin-seed-tools/pull/5)
  makes macOS the default release runner and makes `build.all` run `build.native`. **To release:** merge that PR and bump the
  `tools` submodule here. (On Ubuntu the iOS xcframeworks cannot be built and the script says so.)
* `nativescript.platforms` of the packages now says 8.0.0 (was a stale 6.2.0).

### Reviewing

32 commits, but the history is the story: `core/` (C), `binding/` (napi, android, ios), `src/sqlite/` (TypeScript),
`packages/*` (packaging), `native/` (build scripts), `spike/` (experiments and device apps, not published).
