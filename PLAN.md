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
  tests/              host tests (gtest + ASan), run on macOS CI
binding/napi/         one C file. napi_threadsafe_function -> JS thread, external ArrayBuffer
binding/android/      Java + JNI (bridge backend)
binding/ios/          Objective-C (bridge backend)
src/sqlite/           single TS implementation (replaces .android.ts / .ios.ts / worker.ts)
prebuilt/             android/<abi>/libnssqlite.so, ios/NSSqlite.xcframework
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
Code: `core/provider.{h,c}` (dlsym provider loader), `binding/napi/spike_addon.c`, `NSSqlite.podspec`.

- [x] S1. Host: provider loader resolves `sqlite3_*` via `dlopen` from macOS system SQLite (3.51.0). int64 above 2^53 round-trips exactly, typed bind works, ASan/UBSan clean. A missing library and a missing symbol produce a clear error. `RTLD_DEFAULT` only works if the process already links SQLite.
- [x] S2. Android: Node-API addon built with the NDK (arm64-v8a 42 KB, no SQLite inside), loaded in the NS 9.1.1 app with `require("system_lib://libnssqlite.so")`. Hello call works. A native pthread delivers a result through `napi_threadsafe_function` to the JS thread, with a zero-copy external ArrayBuffer (native tid 17414, JS tid = main thread 17389).
- [x] S3. Android: `dlopen("libsqliteJni.so")` (androidx sqlite-bundled 2.7.1, packaged by the app) from the addon works: SQLite 3.50.1, threadsafe=2, `auto_extension` and `load_extension` present, select works, int64 exact.
- [x] S4. iOS (simulator): the same addon source, compiled as a static CocoaPod into the app, loads with `require("nssqlite_spike")`. Hello, threadsafe callback (native thread -> main thread, ~10 ms) and external ArrayBuffer work.
- [x] S5a. iOS: provider = system SQLite via `dlopen("/usr/lib/libsqlite3.dylib")` (and via `RTLD_DEFAULT`, the process already has it): SQLite 3.51.0, `load_extension` absent, as expected.
- [ ] S5b. iOS: static custom SQLite as provider (symbols from the app binary) not done yet.
- [ ] S6. Non-napi path: bridge binding (JNI / ObjC) on an NS 8.x app, buffer in / buffer out. Not started.
- [ ] S7. Not done: addon used from a `Worker` (own napi env), device builds (arm64 iOS device), packaging as a real plugin (`platforms/android/src/main/jniLibs` aar and iOS xcframework instead of the podspec).

### Findings that change the plan

- **Android packaging:** the app template sets `jniLibs.srcDirs` to its own folders, so libs under `src/main/jniLibs` are ignored unless `app.gradle` adds the dir. For the plugin, ship them in a plugin Android library (`platforms/android/src/main/jniLibs/<abi>` + manifest) so the CLI builds an aar. To be tested.
- **Android linking:** link against the runtime's `libNativeScript.so` as a build-time stub (kept out of packaging), as documented. It worked with `-Wl,-z,max-page-size=16384`.
- **iOS dead-stripping is real:** CocoaPods links static pods with `-ObjC`, which only pulls objects defining ObjC classes. A C-only addon with a constructor is silently dropped (symptom: `Failed to resolve module`). Fix used: an ObjC class whose `+load` calls the (idempotent) registration function. For an xcframework, either keep that class in the same static lib or ship a dynamic framework.
- **iOS needs `static_framework = true`** (NativeScript's Podfile uses `use_frameworks!`), otherwise the pod links as a dynamic framework and fails on the undefined `napi_*` symbols.
- **iOS rebuild gotcha:** `ns run ios` does not rebuild native sources of a local pod; use `--clean`.
- **Headers:** `node_api.h` & co are copied into `binding/napi/include` (taken from the runtime prefab package). The same copy compiled for both runtimes.
- **Tooling:** the locally linked dev CLI (9.2.1) fails on Android with "Unsupported value: 36" (`vendor/gradle-plugin/build.gradle` passes `compileSdk` as a string); published CLI 9.1.2 works. Setting `cli.packageManager = "npm"` was needed because the user config selects yarn (berry), which fails here. CocoaPods needs `LANG=en_US.UTF-8`.
- The `ns create` command fails inside this repo (root yarn config), so the spike app was created outside and copied in.

## Open questions

1. iOS packaging for the final plugin: xcframework (static + ObjC `+load` anchor, or dynamic framework) vs podspec compiled from source. The podspec route works (S4); the xcframework route is untested.
2. androidx `libsqliteJni.so` exports the `sqlite3_*` API today (S3). Google does not promise it stays: pin the androidx version, fail loudly if symbols are missing, and offer our own provider package as the stable alternative.
3. Whether apps can mix the old (non-napi) runtime and this plugin version: decided by the bridge binding in phase 3.
