# Plan: native core, real threading, pluggable SQLite

Branch: `feat/native-core`. Status: planning + spike. Breaking release (major bump).

## Goals

1. **True threading.** All SQL work runs on native threads. JS only encodes a request and decodes a result. Marshaling across the JS/native bridge is kept to one call in and one call out.
2. **App chooses the SQLite.** The plugin ships no SQLite. The app picks a "provider" (stock amalgamation, SQLCipher, androidx `sqlite-bundled`, a custom build with extensions, the iOS system SQLite). The plugin stays small.
3. **Low maintenance.** One C core, one TypeScript implementation, thin per-runtime bindings.

## Findings about the current code (fixed as part of the rewrite)

- Android (`sqlitedatabase.android.ts`): `threading` uses a JS `Worker` plus `WorkersContext`. The worker still runs the cursor loop in JS (one bridge call per cell) and `postMessage` copies the result back.
- iOS (`sqlite.ios.ts`): FMDB on the system SQLite, synchronous, `threading` ignored.
- iOS: `getResultsAsObject` / `getResultsAsArray` have an empty `if (transformBlobs && value instanceof NSData) {}` branch, so blobs are dropped when `transformBlobs` is true (default).
- Android: INTEGER read with `getDouble` (loses > 2^53). `rawQuery(String[])` binds everything as text.
- iOS `selectRaw`: `rows = [...rows,row]` is O(n^2).

## Decisions

- Clean break. No legacy FMDB / framework path.
- Shared **C core** (C11, no exceptions, no templates). No SQLiteCpp: it is only a RAII wrapper, needs a build-time SQLite link (conflicts with providers), and adds nothing for threading or encoding.
- Prebuilt binaries are shipped inside the npm package (Android `.so` per ABI, iOS xcframework / static lib). No NDK needed for users.
- Two runtime bindings over the same core:
  - **Node-API binding (primary).** NativeScript >= 9.1 runtimes expose `napi_*`. The addon is used directly from JS (`require`), results delivered with threadsafe functions, zero-copy external ArrayBuffers, optional native decode into JS objects (faster than any bridge).
  - **Thin bridge binding (older, non-napi runtimes).** Java/JNI on Android, Objective-C on iOS. Same C core, same buffer protocol, ~200-300 lines each.
- TypeScript has a single implementation with a small `Backend` interface. Backends: `napi` (direct) and `bridge` (JNI/ObjC). The wire format is the common denominator; the napi backend may add faster direct paths later.

## Architecture

```
core/                 C11. nssqlite.h (~25 functions, opaque handles, completion callbacks)
  provider            sqlite3_* resolved at runtime into a function table (dlopen/dlsym)
  executor            per-database worker thread (+ optional reader pool in WAL mode)
  statements          typed bind (int64/double/text/blob/null), step loop, statement cache
  encoder             rows -> one compact buffer (header, column names once, tagged cells)
  transactions        pinned connection, batch (atomic), savepoints
  tests/              host tests: plain C harness (no framework), run under ASan+UBSan and TSan
binding/napi/         one C file (nssqlite_napi.c). napi_threadsafe_function -> JS thread, external
                      ArrayBuffer, native row decoding. napi_* resolved at runtime (napi_dyn.*, generated)
binding/android/      JNI (nssqlite_jni.c) + CMake for libnssqlite.so (core + JNI) and libnssqlite_napi.so
binding/ios/          Objective-C bridge (NSSqliteBridge) + the +load anchor of the napi static lib
src/sqlite/           single TS implementation (replaces .android.ts / .ios.ts / worker.ts)
native/                build-android.sh / build-ios.sh: write the prebuilt libs into packages/sqlite-core/platforms
packages/sqlite-core/platforms/android/jniLibs/<abi>/{libnssqlite,libnssqlite_napi}.so + java/.../NativeSqlite.java
packages/sqlite-core/platforms/ios/{NSSqlite,NSSqliteNapi}.xcframework  (static, device + simulator)
```

Removed: `sqlite.android.ts`, `sqlite.ios.ts`, `sqlitedatabase.android.ts`, `worker.ts`, `WorkersContext.java`, FMDB pod, JS cursor code, NSData/ByteBuffer special cases in `paramToString`.

### Provider model (app chooses SQLite and extensions)

- Core never links SQLite. It resolves ~30 `sqlite3_*` symbols by name from a library the app names: `openOrCreate(path, { engine })` or one-time `configure({ engine })`.
- Android providers: androidx `sqlite-bundled` (`libsqliteJni.so`, verified to export the full `sqlite3_*` C API incl. `auto_extension`, `load_extension`, `db_config`; FTS3/4/5, RTREE, STAT4, math enabled; 1.28 MB raw / ~0.65 MB gzipped on arm64), SQLCipher, or any `.so` exporting `sqlite3_*`. The app adds the dependency.
- iOS providers: system SQLite (default, zero bytes, no extension loading), or a static lib / embedded framework with a custom build.
- Extensions: static extensions are the provider's concern (`sqlite3_auto_extension`). Dynamic: `db.loadExtension(path, entry)` where the provider allows it (Android). iOS dynamic loading only with an app-embedded signed framework (not promised).
- Core refuses a provider where `sqlite3_threadsafe() == 0` or required symbols are missing, with a clear error.
- Size (measured for androidx lib; others estimated): core 100-250 KB/ABI (estimate), custom amalgamation ~1 MB arm64 (estimate), SQLCipher several MB (estimate).

### Wire format / marshaling

- Request: JS encodes SQL + params into one buffer (typed values, blobs as views). Native binds with `sqlite3_bind_*` (no stringification).
- Result: one buffer: magic/version, column count, row count, column names once, then tagged cells (null, int32, int64, double, text, blob). int64 as number by default, opt-in BigInt.
- Spike benchmark picks between: (a) TS decoder over the binary buffer, (b) native-built JSON string + `JSON.parse`, (c) napi: build JS objects in C on the JS thread. Bench: 10k rows x 10 cols, blob rows, 10k-insert transaction.
- Delivery to JS: napi `napi_threadsafe_function`; bridge: posted to the caller's captured Looper (Android) / queue or runloop (iOS). Works from main thread and from user Workers (each Worker has its own napi env).

### API changes

- All calls async and native-executed. `threading` deprecated (no-op).
- `batch([{sql, params}], { atomic })`: one native hop, fastest path.
- `transaction((cancel, tx) => ...)`: `tx` pinned to the connection. Calls to `db.*` made while a transaction callback is running are routed to that transaction (otherwise queuing them behind it deadlocks). Documented.
- `each` streams in chunks. `close()` drains the queue. Busy timeout + WAL by default.
- `loadExtension`. Opt-in sync variants for users running their own workers.
- Regression suite: `typeorm/NativescriptQueryRunner.ts` and `nanosql/index.ts` stay on the public API.

## Node-API facts that shape the design (from NativeScript runtime docs, 9.1)

Sources: `NativeScript/android` and `NativeScript/ios` `docs/node-api.md`.

- Both runtimes expose `napi_*` (version 10 surface, env fixed at module API version 8), V8 14.9.
- **Every napi call must run on the env's own thread.** Other threads reach JS only via `napi_threadsafe_function` (queue drained on the env's event loop, at most 64 per entry) or `napi_async_work` (pool of 4, `execute` must not touch the env). We own our executor threads and use threadsafe functions.
- Each `Worker` has its own `napi_env`; the addon init runs again per env. File-scope statics are shared across envs: per-env state goes in `napi_set_instance_data`. The core executor is process-wide and independent of any env; completions are routed to the env that submitted the request.
- External ArrayBuffers (`napi_create_external_arraybuffer`) are zero-copy; the finalizer runs on the env thread, so the core's buffer ownership must allow release from another thread's request.
- `Buffer` is a plain `Uint8Array`.
- **Android loading:** addon is a normal `.so`, registered from a static constructor with `napi_module_register` (do not use `NAPI_MODULE` macros). JS: `require("name")` after the library is loaded, or `require("system_lib://libnssqlite.so")` for a `.so` in `jniLibs`. Headers from the runtime's prefab package; link a build-time-only stub of `libNativeScript.so` (excluded from packaging) or allow undefined `napi_*` symbols.
- **iOS loading:** addon must be compiled into the app binary (no `.node` dylib loading in 9.1). Registered from a static constructor; JS: `require("name")`. A static library needs `-force_load` (or a referenced symbol) so the constructor is not dead-stripped; a dynamic framework avoids that. Open question below.

## Decode benchmark and decision (2026-10-13)

Question: how should a result get from the native buffer to JS rows? Candidates measured on the Node-API binding (code in git history,
commit "chore(bench)"): TypeScript decoder (arrays / objects), native decoder in the addon (per cell napi calls), native JSON +
`JSON.parse`, each with and without an ASCII string heap. Median of 15 interleaved runs (JIT and GC do not favour the first variant),
Android emulator arm64 / iOS simulator, V8 on both. Decode time in ms (query time excluded):

| result | TS arrays | TS arrays + heap | native arrays | native objects | JSON arrays (+native JSON query cost) |
|---|---|---|---|---|---|
| 20000 x 3 (int, short text, real), Android | 7.4 | **1.7** | 19 | 31 | 9.5 (+25) |
| 5000 x 12 mixed with text, Android | 8.3 | **1.3** | 12.6 | 23.8 | 4.6 (+11) |
| 5000 x 3 long text (10% non-ASCII), Android | 32 | 9.2 | 7.5 | 11.4 | 26 (+5) |
| 20000 x 3, iOS simulator | 7.4 | 4.3 | 4.4 | 6.6 | 2.7 (+2.6) |
| 5000 x 3 long text, iOS simulator | 5.8 | 3.8 | 1.8 | 2.7 | 10.9 |
| 1000 x blob(2 KB), either | ~1.2 | ~1.2 | 1.5-2.4 | | - |
| 1 row query round trip | 0.4-0.6 ms Android, 0.01 ms iOS, no measurable difference between decoders | | | | |

Decision:
- **One TypeScript decoder for every backend.** Native decoding (a napi call per cell) is as fast only when strings dominate and loses
  elsewhere; a second decoder would double the maintenance. `decodeRows` was removed from the binding.
- **ASCII string heap in the wire format** (`TEXT_REF`): ASCII strings are stored once in a heap, the reader decodes the heap with one
  `TextDecoder` call and slices it. 2-6x faster decoding of text, costs ~+8% bytes on narrow results. Non-ASCII and empty strings stay inline.
- **JSON dropped:** the native formatting (`%.17g`, escaping) costs more than it saves, and it loses blobs and int64 precision.
- TextDecoder on views: use `subarray` when the runtime honours `byteOffset` (feature detected), `slice` otherwise (NS 8).
- Remaining idea if text-heavy results matter: decode strings natively only when a result is mostly long text (not worth it now).

## TypeScript layer (status)

`src/sqlite/` (single implementation, platform files only for the bridge and the file system):

- `sqlite.ts` public API (`openOrCreate`, `openOrCreateAsync`, `deleteDatabase`, `configure`), `sqlite.common.ts` types + `SqliteError`
- `database.ts` `Database` (shared `QueryApi` for database and transaction): `execute`, `executeScript`, `select`, `selectArray`, `get`,
  `getArray`, `each` (chunked streaming), `batch` (atomic), `transaction` (pinned connection, joins calls made on `db`), `get/setVersion`,
  `loadExtension`, `close`, `ready`
- `codec.ts` params / batch encoder, rows decoder (arrays or objects, int64 modes, blob types); `core.ts` promise helpers, engine loading
- `backend.ts` interface, `backend.napi.ts` Node-API adapter, `platform.android.ts` / `platform.ios.ts` (bridge adapters, napi loading,
  path handling), `platform.common.ts` (backend choice)

Tests:

- **Node**: `native/test-ts.sh` builds the Node-API binding for the host Node and runs `src/sqlite/tests` (node:test) against the real C
  core and a real SQLite: 49 tests (values, errors, open options, close, `each`, `batch`, transactions, two connections, concurrency, 50k rows,
  worker threads with their own env, codec edge cases and malformed input).
- **Devices** (`spike/nssqlite-spike`, `app/api-test.ts`): the public API suite (12 checks per binding) passes on NativeScript 9.1 Android
  emulator and iOS simulator with both bindings, and on NativeScript 8.9 Android emulator and iOS simulator (bridge, `auto` falls back to it).
- Android provider is added with one gradle line (`implementation 'androidx.sqlite:sqlite-bundled:2.7.1'`), no manual copy.

Not done yet: typeorm / nanosql integration tests (adapters compile and were adapted: INSERT returns the id, UPDATE the changes), a
physical-device run, the benchmark of the final TS pipeline against the old plugin, CI scripts, `each` backpressure, API documentation (`docs/`).

## Performance against 3.5.9 (2026-10-13)

Full table, method and caveats in `spike/perf/README.md`; raw logs in `spike/perf/results/`. Headlines (Android emulator / iOS simulator):
reads 20-1000x faster, UI thread stall for a 100000 row query 5.7 s -> 30 ms, batched or concurrent writes 2-30x faster, but awaited one by
one statements 4-8x slower (event loop and thread hand-off per call) unless the new blocking `*Sync` methods are used (then faster than 3.x).

Things found and fixed while measuring:

- JNI bridge: the NativeScript Android runtime pins a global reference per Java object / JS buffer it converts and aborts the process at 51200
  (`global reference table overflow`). Per request callbacks and `ArrayBuffer` parameters reached it after a few thousand queries. The bridge now
  moves only numbers across the boundary: SQL + parameters through a per-thread request arena, results through a per-thread result arena
  (copied by JS right away; results over 512 KB use a one-off buffer), requests numbered, one callback object per thread.
- Cross-thread hand-off latency (50-300 us on a virtualised CPU) dominated tiny statements: the database thread now polls ~60 us after each
  request, and the blocking `execSync` polls ~80 us before sleeping.
- `get`, `select`, ... on 3.x iOS are broken or quadratic (see the perf README): the new implementation does not share those problems.

Open: physical-device numbers, `*Sync` for the bridge backend (JNI / Objective-C), a pipelined JS-side API for loops of awaited statements.

## Phases

0. **Spike** (in progress, see below).
1. Host-testable C core + tests; wire format; provider loader.
2. Napi binding + single TS implementation; benchmark the three decode options; pick one.
3. Bridge bindings (JNI, ObjC) for non-napi runtimes; same TS `Backend` interface.
4. API surface (`batch`, `tx`, chunked `each`, `loadExtension`); typeorm + nanosql green.
5. Packaging: CMake for Android (4 ABIs, 16 KB page alignment) and iOS (device + simulator xcframework), CI producing the prebuilt binaries, npm packaging.
6. Docs, migration notes, release (major).

## Spike results (2026-10-13)

Test app: `spike/nssqlite-spike` (NativeScript 9.1 runtimes: android 9.1.1, ios 9.1.0), see `spike/README.md`.

- [x] S1. Host: provider loader resolves `sqlite3_*` via `dlopen` from macOS system SQLite (3.51.0). int64 above 2^53 round-trips exactly, typed bind works, ASan/UBSan clean. A missing library and a missing symbol produce a clear error. `RTLD_DEFAULT` only works if the process already links SQLite.
- [x] S2. Android: Node-API addon built with the NDK (arm64-v8a 42 KB, no SQLite inside), loaded in the NS 9.1.1 app with `require("system_lib://libnssqlite.so")`. Hello call works. A native pthread delivers a result through `napi_threadsafe_function` to the JS thread, with a zero-copy external ArrayBuffer (native tid 17414, JS tid = main thread 17389).
- [x] S3. Android: `dlopen("libsqliteJni.so")` (androidx sqlite-bundled 2.7.1, packaged by the app) from the addon works: SQLite 3.50.1, threadsafe=2, `auto_extension` and `load_extension` present, select works, int64 exact.
- [x] S4. iOS (simulator): the same addon source, compiled as a static CocoaPod into the app, loads with `require("nssqlite_spike")`. Hello, threadsafe callback (native thread -> main thread, ~10 ms) and external ArrayBuffer work.
- [x] S5a. iOS: provider = system SQLite via `dlopen("/usr/lib/libsqlite3.dylib")` (and via `RTLD_DEFAULT`, the process already has it): SQLite 3.51.0, `load_extension` absent, as expected.
- [x] S5b. iOS: custom SQLite as provider: an embedded dynamic framework (and the `SQLCipher` pod) linked into the app wins `dlsym(RTLD_DEFAULT)` over the system SQLite; also selectable by path. See "Custom engines and extensions".
- [x] S6. Non-napi path: JNI / ObjC bridge verified on NativeScript 8.9 (Android emulator, iOS simulator).
- [x] S7. Worker with its own napi env (9.1 Android + iOS), packaging as a real plugin (aar from `platforms/android/{jniLibs,java}`, static xcframeworks). Physical device builds not run.

## Implementation status (2026-10-13)

Done and tested (commits on `feat/native-core`):

- **C core** (`core/`): engine loader, one worker thread + connection per database, FIFO queue with transaction pinning
  (`tx_begin`/`tx_end`), atomic batches (BEGIN IMMEDIATE / SAVEPOINT), chunked row streaming, 32 entry statement cache,
  typed bind (int64 exact), wire format reader/writer, load/auto extension. Host tests (`core/tests`, plain C harness,
  `cmake -DNSSQLITE_SANITIZE=address,undefined|thread`) pass under ASan+UBSan and TSan: types, errors, script, cache,
  chunks, batch, transactions (queued work waits, rollback, failed BEGIN), close with queued work, open failure,
  open options (WAL, init_sql, read only), 8 submitter threads, 4 parallel databases, 50k row result, truncated/
  malformed wire input. Apple's system SQLite refuses `sqlite3_auto_extension` (returns SQLITE_MISUSE although the symbol
  exists), so the extension test uses Homebrew's SQLite on macOS.
- **JNI bridge** (`binding/android`, `NativeSqlite.java`): results are posted to the Looper of the calling thread.
- **Objective-C bridge** (`binding/ios/NSSqliteBridge`): results are delivered on the run loop of the calling thread.
- **Node-API binding** (`binding/napi`): used directly from JS, one `napi_threadsafe_function` per env, external
  ArrayBuffers (zero copy), native `decodeRows` (arrays/objects, optional BigInt). Works in Workers (own env).
  napi_* is resolved with dlsym at runtime, so the same library/archive loads on runtimes without Node-API and stays inactive.
- **Packaging proven** with `npm pack` tarballs installed into apps: the Android plugin dir (`jniLibs`, `java`) is built into
  an aar by the CLI, iOS static xcframeworks are linked by the CLI (no CocoaPods needed). `package.json#files` must list
  `platforms` (npm otherwise drops it because of the ignore rules).

Test matrix (all pass: open, create/insert/select with every type incl. blob/null/utf8, SQL error, close):

| runtime | bridge (JNI/ObjC) | Node-API direct | Worker |
|---|---|---|---|
| NativeScript 9.1 Android (emulator arm64) | yes | yes | yes |
| NativeScript 9.1 iOS (simulator) | yes | yes | yes |
| NativeScript 8.9 Android (emulator arm64) | yes | n/a (inactive, not loaded) | - |
| NativeScript 8.9 iOS (simulator) | yes | n/a (inactive) | - |

Sizes (stripped): Android libnssqlite.so 21-33 KB + libnssqlite_napi.so 15-23 KB per ABI; iOS xcframeworks 160 KB + 72 KB
(device + simulator slices, before app thinning). Not tested: physical devices (the arm64 device slices are built).

Findings to carry into the TypeScript layer:

- Android bridge: a returned `ByteBuffer` is a Java object in JS; use `ArrayBuffer.from(byteBuffer)` (works on 8.9 and 9.1, shares the
  native memory). Callback results must expose getters (methods), not public fields, to be usable consistently.
- NativeScript 8 `TextDecoder` ignores the `byteOffset` of a view: decode a `slice()` copy, not a `subarray()`.
- Node-API on Android: `require("system_lib://libnssqlite_napi.so")` the first time; afterwards (Workers) the bare
  `require("nssqlite")`. On iOS the bare require works from startup. Loading by path twice fails with "Cannot find 'NSMain'".
- Node-API `napi_create_int64` loses precision above 2^53: `decodeRows` flag `DECODE_BIGINT` returns BigInt for INT64 cells.
- Native object-row decoding is not obviously faster than the TS decoder yet (single noisy runs, 20k rows); needs a real
  benchmark harness before choosing the default decode path.

### Findings that change the plan

- **Android packaging:** the app template sets `jniLibs.srcDirs` to its own folders, so *app* libs under `src/main/jniLibs` are ignored unless `app.gradle` adds the dir (needed only for the provider lib the app ships). A *plugin* puts libs in `platforms/android/jniLibs/<abi>` and the CLI builds an aar (verified).
- **iOS dead-stripping is real:** the CLI/CocoaPods link static libraries with `-ObjC`, which only pulls objects defining ObjC classes. A C-only addon with a constructor is silently dropped (symptom: `Failed to resolve module`). Fix used: an ObjC class whose `+load` calls the (idempotent) registration function, in the same static lib.
- **iOS rebuild gotcha:** `ns run` does not notice changed prebuilt native libs; use `--clean`.
- **A static lib that references `napi_*` cannot link on NativeScript 8 runtimes** (undefined symbols). Resolving napi_* with dlsym (generated table) fixes that and also removes the need to link a stub `libNativeScript.so` on Android.
- **Headers:** `node_api.h` & co are copied into `binding/napi/include` (taken from the runtime prefab package). The same copy compiled for both runtimes.
- **Tooling:** the locally linked dev CLI failed on Android with "Unsupported value: 36" because `vendor/gradle-plugin/build.gradle` used `-PcompileSdk` as a string. Fixed in `nativescript-cli` (`compileSdk as int`, `targetSdk as int`); apps set `compileSdk = 36; targetSdk = 36` in `before-plugins.gradle`. The user config selects yarn 4, so apps need `packageManager: yarn@4` + `.yarnrc.yml` (classic yarn fails on `yarn npm info`).
- The `ns create` command fails inside this repo (root yarn config), so the spike app was created outside and copied in.

## Open questions

1. iOS packaging for the final plugin: xcframework (static + ObjC `+load` anchor, or dynamic framework) vs podspec compiled from source. The podspec route works (S4); the xcframework route is untested.
2. androidx `libsqliteJni.so` exports the `sqlite3_*` API today (S3). Google does not promise it stays: pin the androidx version, fail loudly if symbols are missing, and offer our own provider package as the stable alternative.
3. Whether apps can mix the old (non-napi) runtime and this plugin version: decided by the bridge binding in phase 3.

## Custom engines and extensions (2026-10-13)

What was tested (`native/build-custom-sqlite.sh`, `native/build-ext.sh`, `native/ext/`, `spike/nssqlite-spike/app/engine-test.ts`, `src/sqlite/tests/extension.test.ts`):

- **Sample extension** `native/ext/ns_ext.c`: scalar functions plus an aggregate, built three ways from one file: loadable (`libns_ext.so`, `NSSampleExt.framework`), compiled into a custom SQLite (`-DSQLITE_CORE`, `SQLITE_EXTRA_INIT` -> `sqlite3_auto_extension`), host tests.
- **Node** (Homebrew SQLite, 6 tests): `loadExtension` with and without entry point, per connection, while requests are queued and inside a transaction, error cases, `canLoadExtensions()`; Apple's system SQLite reports `false` and a clear error.
- **Android** (emulator, NS 9.1, napi and bridge, 28 checks): androidx 3.50.1, a custom 3.53.4 amalgamation (FTS5, JSON, RTREE, `DQS=0`, compiled-in extension, 1.5 MB per ABI), SQLCipher (`net.zetetic:sqlcipher-android:4.19.1`): file encrypted, no key and wrong key give NOTADB (26), right key + WAL; `loadExtension('libns_ext.so')` on androidx and on the custom build; `configure({engine})`; unknown engine throws naming the library; three engines (androidx, custom, SQLCipher) running transactions in parallel on separate databases.
- **iOS** (simulator, NS 9.1, napi and bridge): system SQLite (no extension loading, clear error); custom build as embedded dynamic framework (14 checks: compile options, FTS5/JSON, compiled-in extension, `loadExtension` of a signed framework with explicit entry point, custom + system engines at once); the `SQLCipher` 4.10 pod through the default engine (6 checks).

Findings:

1. **Bug fixed**: the core ran `PRAGMA journal_mode=WAL` before `initSql`, so `wal: true` + `PRAGMA key` failed with "file is not a database". `initSql` now runs first (host test added).
2. iOS: a dynamic framework or pod linked into the app is found first by `dlsym(RTLD_DEFAULT)`, so the default engine (`null`) becomes the app's SQLite without configuration. The system one stays reachable with `engine: '/usr/lib/libsqlite3.dylib'`. Static libraries were not tried (they need `-force_load` / `-export_dynamic` to be visible to `dlsym`); the dynamic framework route is the documented one.
3. New `Database.canLoadExtensions()` so apps can branch instead of catching.
4. The SQLCipher pod is built from the CLI's `use_frameworks!` Podfile; a stale `platforms/ios/Podfile` made `ns run` fail with a Podfile syntax error until `platforms/ios` was removed (CLI behaviour, unrelated to the plugin).
5. Not tested: NativeScript 8 with custom engines (same JNI / bridge code path as the 9.1 bridge runs), physical devices, iOS device slices of the custom frameworks (built, not run), Android armeabi-v7a/x86.

## Package split and static providers (2026-10-13)

- **Current dependencies**: the plugin had none: empty `include.gradle`, no Podfile. The app added `androidx.sqlite:sqlite-bundled` itself and iOS used the process SQLite.
- **Two packages now**: `@nativescript-community/sqlite-core` (`packages/sqlite-core`: sources of `src/sqlite`, the prebuilt binaries, typeorm / nanosql adapters; no dependency, no default engine: `openOrCreate` throws "No SQLite engine chosen" until `configure({ engine })` or the `engine` option) and `@nativescript-community/sqlite` (`packages/sqlite`, sources `src/sqlite-default`): depends on core, `include.gradle` adds androidx sqlite-bundled, `configure({ defaultEngine })` at import (`libsqliteJni.so` / `null`), re-exports core, `/typeorm`, `/nanosql`. `engine` still wins over `defaultEngine`, whatever the import order. Users who bring their own SQLite depend on core only and have nothing to remove.
- **Proven** (`npm pack` of both, only `sqlite` in the app's dependencies): the CLI picks up the transitive core plugin (platform libs, java) and the gradle dependency from the default package; API 12/12 per binding, ORM 8/8, engine tests on Android (28/28) and iOS (default engine = system SQLite). Bare: an app with only `sqlite-core` + SQLCipher: no engine throws the explicit error, androidx is not in the APK (opening `libsqliteJni.so` fails), `configure({engine})` works (`app/bare-test.ts`, Android and iOS).
- **iOS static SQLite**: `dlsym` cannot be relied on for the symbols of a static library (not exported, not even linked unless referenced). Fix: `nssqlite_register_provider(name, table)` in the core, called at startup by `native/provider/NSSqliteStaticProvider.m`, which sits in the same static library as the SQLite and references `sqlite3_*` directly (so the linker pulls the right object in). The app uses `engine: '@static'`. Host test added; device test: static custom build next to the system SQLite, FTS5/JSON, compiled-in extension, both in parallel (10/10, napi and bridge). Note: in that debug build the default engine (`null`) also found the static symbols through `dlsym`; not guaranteed (release / dead-strip), hence the registry.
- Not done: publishing metadata (versions, changelog for the new package), static provider for release builds with `-dead_strip`, CocoaPods static pod example, NativeScript 8 run of the split packages.

## Platform SQLite on Android: sqlite-android-framework (2026-10-13, prototype)

`packages/sqlite-android-framework` (`@nativescript-community/sqlite-android-framework`, peer of core, ~25 KB per ABI, no change to the C core).
Design: `libnssqlite_framework.so` (`binding/android-framework/shim.c`) exports the ~35 `sqlite3_*` functions the core resolves with `dlsym`, implemented on
`com.akylas.sqlite.framework.FrameworkEngine` (Java, `android.database.sqlite` only, no dependency). Per statement one JNI call: Java runs it and returns
blocks of rows in the core's own wire format, which the shim parses with the core reader and serves to `column_*` from memory (no per-cell JNI, no global refs).
Params go the other way as a params block. The JS entry (`useFrameworkEngine`) only loads the library (`JNI_OnLoad` needs `System.loadLibrary`) and calls `configure({ engine })`.
Framework quirks handled: typed binds through `CursorFactory` + `SQLiteQuery`; DML through `SQLiteStatement.executeUpdateDelete` (changes) plus a rowid query for INSERT;
`BEGIN/COMMIT/ROLLBACK` mapped to `beginTransaction*` / `endTransaction` (the framework's session is per thread, which fits the one worker per database;
`ROLLBACK TO` is left as a plain statement); `PRAGMA journal_mode=WAL` calls `enableWriteAheadLogging`; `NO_LOCALIZED_COLLATORS` avoids the `android_metadata` table;
errors parsed from `(code N ...)` in the framework messages give the real SQLite codes (19 / 2067 for UNIQUE); statement tail / parameter count by a small scanner.
Result: 11/11 device checks with both bindings (types, int64, big blobs/text, results, error codes, atomic batch, transactions with inner savepoint, `each` 20000 rows, scripts with triggers, WAL, reopen, read-only, parallel databases, RETURNING) on API-level emulator with SQLite 3.50.4.
Speed vs androidx through the same core (emulator, warm): select 20000x3 ~14 vs ~3 ms, 1000 awaited point lookups ~55 vs ~40, 5000 inserts in a tx ~80 vs ~20, `batch` 5000 ~60 vs ~7 ms.
Limits: no extensions / SQLCipher, version and options set by the OS, fixed busy timeout, rows over the 2 MB cursor window fail, first read counts all rows.
Not done: older Android versions (the emulator has a recent SQLite), physical devices, TypeORM on this engine, avoiding the rowid query, `loadFrameworkEngine` in workers (library is loaded once per process, config is per realm).

## WAL by default on Android (2026-10-13)

Phone measurement: 500 awaited one-statement writes 2600 ms with androidx's default journal (DELETE), 38 ms in WAL (3.5.9, on the Android framework's TRUNCATE default: 824 ms).
`@nativescript-community/sqlite` now configures `defaultOptions: { wal: true }` on Android (new `configure({ defaultOptions })` in core: options a database starts from, the
ones given to `openOrCreate` win, `{ wal: false }` opts out). `sqlite-core` itself defaults to nothing. Core: `wal` is ignored for read-only connections (switching the journal
mode needs a write); a database that failed to open now answers later requests with the SQLite error of the open instead of `-1` (SQLCipher wrong key + `wal` now reports code 26 on the first request).
Device suites on Android emulator and iOS simulator: API 13/13 per binding (new check: default WAL on Android, `delete` on iOS, `wal: false`, read-only, `:memory:`), ORM 8/8, engines 28/28 (Android).

## Packages: core / napi / bridge / default / framework (2026-10-13)

The bridges are split from the core and every binding is its own package (all `3.5.9` for now, bumped together by lerna):

- `sqlite-core`: TypeScript API + the C core as its own library (`libnssqlite_core.so`, `NSSqliteCore.xcframework`; its headers are the ones the static-SQLite glue needs). No binding, no SQLite, no dependency.
- `sqlite-napi`: `libnssqlite_napi.so` / `NSSqliteNapi.xcframework` (links the core). `sqlite-bridge`: `libnssqlite_jni.so` + `NativeSqlite.java` / `NSSqliteBridge.xcframework` (links the core).
- `sqlite`: core + napi + bridge + androidx (`include.gradle`) + `defaultEngine` / `defaultOptions` (WAL on Android). `sqlite-android-framework`: engine only (needs core + a binding).
- Sizes (arm64): Android core 28 KB, napi 23 KB, JNI 10 KB; iOS device slice core 32 KB, napi 29 KB, bridge 17 KB.
- TS binding discovery (`platform.common.ts`): `auto` tries Node-API then the bridge; a missing package is reported by name ("install @nativescript-community/sqlite-napi / sqlite-bridge"), `backend: 'napi'|'bridge'` fail instead of falling back.
- Proven: umbrella on NativeScript 9.1 Android emulator (API 13/13 per binding, ORM 8/8, engines 28/28) and iOS simulator (13/13, 8/8, 2/2); NativeScript 8.9.2 Android (umbrella, `auto` falls back to the bridge, 13/13 per mode); lean apps: core + napi only (Android, iOS) and core + bridge only (Android) with SQLCipher, checking the error naming the missing package and that the APK has no JNI library or `NativeSqlite` class. NativeScript 8.9 needed the SDK level pinned in `before-plugins.gradle` (`compileSdk = 35`, an int) with the local CLI, unrelated to the split.
- Not done: iOS lean app with the bridge only, NativeScript 8 on iOS with the split, the sqlite-android-framework on the split (builds, not rerun), publishing metadata for the two new packages.
