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
native/                build-android.sh / build-ios.sh: write the prebuilt libs into packages/sqlite/platforms
packages/sqlite/platforms/android/jniLibs/<abi>/{libnssqlite,libnssqlite_napi}.so + java/.../NativeSqlite.java
packages/sqlite/platforms/ios/{NSSqlite,NSSqliteNapi}.xcframework  (static, device + simulator)
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
- [ ] S5b. iOS: static custom SQLite as provider (symbols from the app binary) not done yet.
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
