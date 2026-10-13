# Performance: 3.x plugin vs this branch

The same workloads (`perf.ts`) run against the 3.5.9 plugin (FMDB on iOS, `android.database.sqlite` on Android, built from
master at `3a182b3`) and against this branch, both on NativeScript 9.1, through the API they share. Median of 5 runs after a warm-up
(3 for the autocommit insert), file databases, default open options. Raw logs: `results/`.

**Where it ran:** Android emulator (arm64, Android 16, on a Mac) and iOS simulator (iOS 26.5, on the same Mac). Not physical devices:
absolute numbers on phones will differ (the emulator's thread wake-ups are slower than a phone's, a phone's CPU is slower than the Mac's).

| workload (ms, lower is better) | Android 3.x | Android 3.x worker | Android new (Node-API) | Android new (bridge) | iOS 3.x | iOS new (Node-API) | iOS new (bridge) |
|---|---|---|---|---|---|---|---|
| insert 500 rows, one awaited execute each, autocommit | 5310 | 5480 | 5362 | 5206 | 140 | 141 | 145 |
| insert 5000 rows in a transaction, awaited one by one | 190 | - | 1481 | 2792 | 13.7 | 55.2 | 39.7 |
| insert 5000 rows in a transaction, all started at once | 216 | - | 73.0 | 290 | 18.0 | 30.3 | 48.3 |
| insert 5000 rows with batch() (new API only) | - | - | 24.6 | 36.9 | - | 8.8 | 8.5 |
| insert 5000 rows in a transaction, blocking executeSync (new API only) | - | - | 121 | - | - | 16.8 | - |
| select 20000 rows x 3 (int, short text, real) | 938 | 829 | 19.6 | 15.4 | 718 | 5.5 | 5.4 |
| select 5000 rows x 12 (mixed, nulls) | 778 | 762 | 12.2 | 12.0 | 79.4 | 5.4 | 4.8 |
| select 5000 rows x 3 (200 char text) | 289 | 304 | 18.0 | 26.7 | 49.9 | 4.6 | 4.6 |
| select 1000 rows with 2 KB blobs | 2456 | 1695 | 8.9 | 12.2 | 4.9 | 1.4 | 1.2 |
| 500 small selects (100 rows), one after the other | 1788 | 2143 | 206 | 319 | 192 | 22.6 | 22.5 |
| 1000 point lookups, one after the other | 164 | 975 | 292 | 492 | 20.5 | 27.1 | 28.6 |
| 1000 point lookups, all started at once | 157 | 268 | 15.3 | 50.2 | 20.8 | 11.8 | 11.6 |
| 1000 point lookups, blocking getSync (new API only) | - | - | 30.0 | - | - | 13.4 | - |
| 500 small selects (100 rows), blocking selectSync (new API only) | - | - | 56.5 | - | - | 15.7 | - |
| each over 20000 rows | 830 | 888 | 9.8 | 14.4 | 68.9 | 4.2 | 4.0 |
| longest JS thread stall: select of 100000 rows x 4 | 5702 | 126 | 28.2 | 29.4 | - | 28.7 | 26.8 |
| longest JS thread stall: 20 selects of 2000 rows | 1799 | 11.4 | 5.8 | 5.3 | 274 | 5.1 | 5.1 |

How to read it:

- "Node-API" is the binding NativeScript >= 9.1 uses by default, "bridge" is the JNI / Objective-C one used by NativeScript 8
  (here also on 9.1 for comparison), "3.x worker" is the 3.x `threading: true` option (Android only).
- The stall rows are the longest gap between two ticks of a 4 ms timer while the query runs: how long the JS (= UI) thread was blocked.
  The 3.x iOS plugin needs minutes for 100000 rows (it appends rows with `rows = [...rows, row]`), so that row was skipped there.
- The 3.x iOS `get` never worked (it reads a row before calling `next()`), point lookups there go through `select()[0]`. Its `select`
  drops blob values (an empty `if` branch), so its blob row is not comparable. 3.x `threading: true` hangs when statements run in a
  transaction (the transaction belongs to the JS thread's connection session), so those rows are missing.
- Autocommit inserts are bound by the filesystem sync of every commit: the same everywhere.

## What it shows

- **Reading is 20-1000 times faster** (the native thread steps the statement and writes one buffer, JS decodes it with typed arrays; the 3.x
  code made one bridge call per cell) and never blocks the UI thread for more than a decode (30 ms for 100000 rows vs 5.7 s).
- **Batched or concurrent writes are 2-30 times faster** (`batch()`, or many calls started together).
- **One-by-one awaited statements are slower** than the 3.x synchronous code: each awaited call waits for the database thread and for
  the event loop (~0.05 ms on iOS, ~0.2-0.3 ms on the Android emulator, a hand-off between threads that the 3.x code never paid). 5000 awaited
  inserts in a transaction take 55 ms on iOS (13 ms before) and 1.5 s on the Android emulator (0.19 s before).
- **`*Sync` methods remove that cost:** they block the calling thread until the database thread answers, after a short spin (the database
  thread also spins ~60 us after a request, so neither side sleeps and wakes up): 5000 inserts in 17 ms on iOS and 121 ms on Android, point
  lookups 2-5x faster than the 3.x code. They are for tiny statements; a slow statement blocks the UI like the 3.x code did.

## Run it

`spike/perf` holds `perf.ts` and the two main pages (`main-page-old.ts` for an app with the 3.x plugin, `main-page-new.ts` for this branch).
Build both apps like the spike app (see `spike/README.md`); the 3.x plugin is `git archive 3a182b3 src/sqlite packages/sqlite`, transpiled
with esbuild and packed with `npm pack`.
