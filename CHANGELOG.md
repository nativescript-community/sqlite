# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## [4.1.0](https://github.com/nativescript-community/sqlite/compare/v4.0.1...v4.1.0) (2026-10-18)

### Features

* **android:** add sqlite-shared-engine shipping SQLite as libsqlite.so ([c82a13b](https://github.com/nativescript-community/sqlite/commit/c82a13b9fb97806632e38365c11393681b923d70))

## [4.0.1](https://github.com/nativescript-community/sqlite/compare/v4.0.0...v4.0.1) (2026-10-14)

**Note:** Version bump only for package sqlite

## [4.0.0](https://github.com/nativescript-community/sqlite/compare/v3.5.9...v4.0.0) (2026-10-14)

### ⚠ BREAKING CHANGES

* 4.0 replaces the internals of the plugin. close() and getVersion() return promises, execute() resolves to
{ changes, lastInsertRowId }, openOrCreate() opens in the background (open errors come from db.ready or the first query),
parameters are bound with their real types instead of strings, wrapDb / db.db / byteArrayToBuffer / arrayToNativeByteArray /
paramToString and the WorkersContext class are removed, threading / cursorWindowSize / cursorWindowName are ignored, Android
uses androidx sqlite-bundled with WAL on by default instead of the platform SQLite, iOS no longer uses FMDB, minimum
NativeScript 8. See MIGRATION.md.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>

### Features

* **android-framework:** configurable cursor window (default 16 MB), clear error for a row that does not fit ([a21b8ca](https://github.com/nativescript-community/sqlite/commit/a21b8ca55d9da4ed1e9ad1192e0f54133d898ecd))
* **core:** C core with executor, statement cache and wire format ([555ec4e](https://github.com/nativescript-community/sqlite/commit/555ec4e1c3530d7d16dbc0a5f6386fd1c0d612d0))
* custom engines and extensions tests, canLoadExtensions, initSql before WAL ([f02d5c9](https://github.com/nativescript-community/sqlite/commit/f02d5c9a87158f4576ce2be072f6164432a9d952))
* **napi:** native UTF-8 conversion for long strings (runtimes without TextDecoder) ([5306d6c](https://github.com/nativescript-community/sqlite/commit/5306d6c30c2658689c452b020a2f8eca5e93508c))
* **napi:** polling mode for runtimes without threadsafe functions (QuickJS) ([830b65a](https://github.com/nativescript-community/sqlite/commit/830b65a86440cb969baf27cd15f9ad1b973d7b7b))
* **native:** JNI and Objective-C bridge bindings, prebuilt packaging ([bd3b2b9](https://github.com/nativescript-community/sqlite/commit/bd3b2b97b8ce618cfa3527e3226b7d75f93712ee))
* **native:** Node-API binding, runtime-resolved napi, old runtime support ([d0af9f2](https://github.com/nativescript-community/sqlite/commit/d0af9f2ef3388a9e9cf0b4f546f151f8091ab490))
* **native:** spike native core, provider loader and napi addon ([ec9da9d](https://github.com/nativescript-community/sqlite/commit/ec9da9da7ade3452dbe9e19c81239270ae5021ab))
* split into sqlite-core (bare) and sqlite (default engine), iOS static SQLite providers ([6008f7a](https://github.com/nativescript-community/sqlite/commit/6008f7a0952dfebb14bc9da4d83957d529eac8c9))
* split JNI / Objective-C bridges and the Node-API binding into sqlite-bridge and sqlite-napi ([c206afc](https://github.com/nativescript-community/sqlite/commit/c206afcf709a76106b188e5538ad06d893546b6b))
* sqlite-android-framework, the platform SQLite (android.database.sqlite) as an engine (prototype) ([9cf7dc7](https://github.com/nativescript-community/sqlite/commit/9cf7dc742dc32d373d0ef50c120cab6e0fe8497f))
* sqlite-default-engine package, so androidx can be used without the bridges ([ebefd97](https://github.com/nativescript-community/sqlite/commit/ebefd975c475726665408c3d8a5a9a977111aaf9))
* TypeScript layer on the native core, string heap wire format ([3caf8cb](https://github.com/nativescript-community/sqlite/commit/3caf8cb21a9cde91d835deab5560a3aae81a1afa))
* WAL by default on Android in @nativescript-community/sqlite, configure({ defaultOptions }) ([3030907](https://github.com/nativescript-community/sqlite/commit/30309076be96088c2016d835bfe0342ab64bf1c2))

### Bug Fixes

* **core:** transaction() runs its action immediately; translate Android flags of 3.x ([8552478](https://github.com/nativescript-community/sqlite/commit/8552478aa9bd26dd5db2387b2886789eaf12c3e3))
* do not need TextDecoder / TextEncoder when the codec module loads ([ce18eea](https://github.com/nativescript-community/sqlite/commit/ce18eead8366cd7151767fe843ccee6528c1beb9))
* **napi:** a throwing result callback no longer strands the other results in polling mode ([91b5170](https://github.com/nativescript-community/sqlite/commit/91b5170e522ff45ad20c5149072f7d872616eff3))
* **napi:** export napi_register_module_v1, napi_module_register optional ([6086cfd](https://github.com/nativescript-community/sqlite/commit/6086cfddc209e3e524656073c2026002c717494b))
* **napi:** never return NULL from napi_register_module_v1, report a missing Node-API function ([b57998d](https://github.com/nativescript-community/sqlite/commit/b57998d788724c92845ad9812c1997462db2c6fe))

### Performance Improvements

* comparison with 3.5.9, arena-based JNI bridge, blocking Sync calls ([a725e2d](https://github.com/nativescript-community/sqlite/commit/a725e2d76851b595d86e87899662f789a4d16e7d))
* **napi:** polling mode waits briefly for a lone request instead of a timer round trip ([17c0e1d](https://github.com/nativescript-community/sqlite/commit/17c0e1d32753fc0357fdd854570a05546d7c380f))
* run on a physical Android phone, autocommit journal modes, platform SQLite column ([b4fdd21](https://github.com/nativescript-community/sqlite/commit/b4fdd2119c73eee9cd7c68e98b69b7ace96e6559))

### Miscellaneous Chores

* leave the version bump and changelogs to the release workflow ([9a94f30](https://github.com/nativescript-community/sqlite/commit/9a94f30f2d45363fff8d3bed855ccf1f7b24cc87))

## [3.5.9](https://github.com/nativescript-community/sqlite/compare/v3.5.8...v3.5.9) (2026-05-18)

### Bug Fixes

* **sqlite:** android fix for android 8.x ([e314e87](https://github.com/nativescript-community/sqlite/commit/e314e87435ccdb485c86648edc252a7fe807274b))

## [3.5.8](https://github.com/nativescript-community/sqlite/compare/v3.5.7...v3.5.8) (2026-04-23)

### Bug Fixes

* **android:** native api usage fix ([0ca595f](https://github.com/nativescript-community/sqlite/commit/0ca595f1ed1629670f19cc177e4adc5dd2b250d3))

## [3.5.7](https://github.com/nativescript-community/sqlite/compare/v3.5.6...v3.5.7) (2026-04-23)

### Bug Fixes

* open db options fix ([cdd4e6c](https://github.com/nativescript-community/sqlite/commit/cdd4e6cc3e0b556b21509a80bdf8b0c80f85ff29))

## [3.5.6](https://github.com/nativescript-community/sqlite/compare/v3.5.1...v3.5.6) (2026-04-23)

### Bug Fixes

* add support for `cursorWindowSize` on db and requests to prevent SQLiteBlobTooBigException on android ([b64f1b7](https://github.com/nativescript-community/sqlite/commit/b64f1b78c3123fda75fc0da5ba84b6cf62349139))

## [3.5.1](https://github.com/nativescript-community/sqlite/compare/v3.5.0...v3.5.1) (2024-07-17)

### Features

* new `wrapDb` method to use existing native database ([b0ea41d](https://github.com/nativescript-community/sqlite/commit/b0ea41da36b024c636d10fce16f57eba0934ef9c))

# [3.5.0](https://github.com/nativescript-community/sqlite/compare/v3.4.2...v3.5.0) (2024-01-03)

### Bug Fixes

* **ios:** transaction fix ([187bd04](https://github.com/nativescript-community/sqlite/commit/187bd0443dd2c66b1089bfb8cd859829d50b5390))

### Features

* **typeorm:** update driver to work with latest typeorm version ([ee32114](https://github.com/nativescript-community/sqlite/commit/ee321145ae0c97ef0b268c2056292e084ddaa3d1))

## [3.4.2](https://github.com/nativescript-community/sqlite/compare/v3.4.1...v3.4.2) (2023-04-30)

### Bug Fixes

* **android:** native-api-usage ([8ae5291](https://github.com/nativescript-community/sqlite/commit/8ae52917baed61dec106d9f328f57a8791c79f87))

## [3.4.1](https://github.com/nativescript-community/sqlite/compare/v3.4.0...v3.4.1) (2022-02-01)

### Bug Fixes

* **android:** native-api-usage fix ([eebc24e](https://github.com/nativescript-community/sqlite/commit/eebc24e70390453cf7cff606f51c8a93e4f9e143))

# [3.4.0](https://github.com/nativescript-community/sqlite/compare/v3.3.12...v3.4.0) (2021-10-03)

### Bug Fixes

* N8 /. webpack5 workers ([ea25c67](https://github.com/nativescript-community/sqlite/commit/ea25c67184cc7325c0459f4567abcee05ad350d9))

### Features

* **android:** native-api-usage ([ec069b2](https://github.com/nativescript-community/sqlite/commit/ec069b23891bb59aa8582d037190ca31d4729932))

## [3.3.12](https://github.com/TestJG/nativescript-mtmobile-sqlite/compare/v3.3.11...v3.3.12) (2021-05-04)

### Features

* Correctly transform ArrayBuffer to write in DB ([1fab926](https://github.com/TestJG/nativescript-mtmobile-sqlite/commit/1fab926081c5e086bb602d9036a82adc26c9156c))

## [3.3.11](https://github.com/TestJG/nativescript-mtmobile-sqlite/compare/v3.3.10...v3.3.11) (2020-11-26)

### Bug Fixes

* another fix for typeorm ([3f25614](https://github.com/TestJG/nativescript-mtmobile-sqlite/commit/3f25614e9d60d78f3a1dbc42b699b93dc8c7a616))
* transaction is async ([0ec1ced](https://github.com/TestJG/nativescript-mtmobile-sqlite/commit/0ec1cedc74be5145e48fb454980d7fe406a45170))

## [3.3.10](https://github.com/TestJG/nativescript-mtmobile-sqlite/compare/v3.3.9...v3.3.10) (2020-11-11)

**Note:** Version bump only for package @nativescript-community/sqlite

## [3.3.9](https://github.com/TestJG/nativescript-mtmobile-sqlite/compare/v3.3.8...v3.3.9) (2020-11-09)

### Bug Fixes

* android handle all data types ([28c0c57](https://github.com/TestJG/nativescript-mtmobile-sqlite/commit/28c0c57ab35e43c09d7cca7d6cbd1f269f12ff8d))
* for now allow any typeorm version ([96f4a2a](https://github.com/TestJG/nativescript-mtmobile-sqlite/commit/96f4a2a3fbdcac3c3488bfc054ad7e9c218c9c29))
* handle for native objects ([c983906](https://github.com/TestJG/nativescript-mtmobile-sqlite/commit/c9839069b35f641218516fd98264ed8fdda0318d))

## [3.3.8](https://github.com/TestJG/nativescript-mtmobile-sqlite/compare/v3.3.7...v3.3.8) (2020-11-04)

### Bug Fixes

* bring back fix for 0.2.25 ([3fecc41](https://github.com/TestJG/nativescript-mtmobile-sqlite/commit/3fecc419567e43fd32b5e753a0bc944a27e0d8d2))

## [3.3.7](https://github.com/TestJG/nativescript-mtmobile-sqlite/compare/v3.3.6...v3.3.7) (2020-11-03)

**Note:** Version bump only for package @nativescript-community/sqlite

## [3.3.6](https://github.com/TestJG/nativescript-mtmobile-sqlite/compare/v3.3.5...v3.3.6) (2020-11-02)

**Note:** Version bump only for package @nativescript-community/sqlite

## [3.3.5](https://github.com/TestJG/nativescript-mtmobile-sqlite/compare/v3.3.4...v3.3.5) (2020-11-01)

**Note:** Version bump only for package @nativescript-community/sqlite

## [3.3.4](https://github.com/TestJG/nativescript-mtmobile-sqlite/compare/v3.3.3...v3.3.4) (2020-11-01)

### Bug Fixes

* update typeorm ([ba47b86](https://github.com/TestJG/nativescript-mtmobile-sqlite/commit/ba47b86d7ae602f6d0386d730d5feac50bd131bc))

## [3.3.3](https://github.com/TestJG/nativescript-mtmobile-sqlite/compare/v3.3.2...v3.3.3) (2020-11-01)

### Bug Fixes

* hook fix ([dbf049a](https://github.com/TestJG/nativescript-mtmobile-sqlite/commit/dbf049ab94ee0074cf89ee4b85cddbb54ffe1a20))

## [3.3.2](https://github.com/TestJG/nativescript-mtmobile-sqlite/compare/v3.3.1...v3.3.2) (2020-11-01)

### Bug Fixes

* hook for aliases to get smaller bundle ([954b1d9](https://github.com/TestJG/nativescript-mtmobile-sqlite/commit/954b1d9591882f8943edc28c70ba7f2c6ce2f150))
* thank you eslitn ([45400e4](https://github.com/TestJG/nativescript-mtmobile-sqlite/commit/45400e4028e631e61dfeb16862edf419153ce088))

## [3.3.1](https://github.com/TestJG/nativescript-mtmobile-sqlite/compare/v3.3.0...v3.3.1) (2020-10-31)

### Bug Fixes

* refactor for much smaller worker ([f9d8a60](https://github.com/TestJG/nativescript-mtmobile-sqlite/commit/f9d8a60ceac58c4bb3791b442af1e985ce148968))
* try to make worker faster and ligher ([d18ac6e](https://github.com/TestJG/nativescript-mtmobile-sqlite/commit/d18ac6e071c8c76ba86da73d44bf0eb44ac44f83))

# [3.3.0](https://github.com/TestJG/nativescript-mtmobile-sqlite/compare/v3.2.0...v3.3.0) (2020-10-16)

### Features

* working threading on android ([3c4e538](https://github.com/TestJG/nativescript-mtmobile-sqlite/commit/3c4e538c54a26c05f780cb947ee80955f83aebc6))

# [3.2.0](https://github.com/TestJG/nativescript-mtmobile-sqlite/compare/v3.1.1...v3.2.0) (2020-09-06)

### Features

* N7 and new plugin name ([e3023d6](https://github.com/TestJG/nativescript-mtmobile-sqlite/commit/e3023d6ec2a806d404b654c5b3df118889757fe3))

## [3.1.1](https://github.com/TestJG/nativescript-mtmobile-sqlite/compare/v3.1.0...v3.1.1) (2020-08-14)

### Bug Fixes

* log removal ([bc9df6e](https://github.com/TestJG/nativescript-mtmobile-sqlite/commit/bc9df6ec6161ad3060a00d072a22de362027ccf2))

# [3.1.0](https://github.com/TestJG/nativescript-mtmobile-sqlite/compare/v3.0.5...v3.1.0) (2020-08-14)

### Features

* move to @nativescript-community/sqlite ([71ef0c1](https://github.com/TestJG/nativescript-mtmobile-sqlite/commit/71ef0c1b96b3cbc60b67a63a02fcc38e1428524e))

## [3.0.5](https://github.com/TestJG/nativescript-mtmobile-sqlite/compare/v3.0.4...v3.0.5) (2020-05-29)

### Bug Fixes

* nano sql fi ([db275c1](https://github.com/TestJG/nativescript-mtmobile-sqlite/commit/db275c12bf0042c0e7e790978acd63af3873b7f4))

## [3.0.4](https://github.com/TestJG/nativescript-mtmobile-sqlite/compare/v3.0.3...v3.0.4) (2020-05-29)

**Note:** Version bump only for package nativescript-akylas-sqlite

## [3.0.3](https://github.com/TestJG/nativescript-mtmobile-sqlite/compare/v3.0.2...v3.0.3) (2020-04-24)

### Bug Fixes

* opening db in android ([153fd37](https://github.com/TestJG/nativescript-mtmobile-sqlite/commit/153fd372daf667844767ea8548af8c0fd2f343c5))

## [3.0.2](https://github.com/TestJG/nativescript-mtmobile-sqlite/compare/v3.0.1...v3.0.2) (2019-12-18)

### Bug Fixes

* more logs cleanup ([58ef7d3](https://github.com/TestJG/nativescript-mtmobile-sqlite/commit/58ef7d3c27bf898bb865b8b80e20e55585bb0f42))

## [3.0.1](https://github.com/TestJG/nativescript-mtmobile-sqlite/compare/v3.0.0...v3.0.1) (2019-12-17)

### Bug Fixes

* remove unwanted logs ([0003afb](https://github.com/TestJG/nativescript-mtmobile-sqlite/commit/0003afb28d6947d8c22c829cd0d101ced81ad73b))
* remove unwanted logs ([a1cd162](https://github.com/TestJG/nativescript-mtmobile-sqlite/commit/a1cd162a3b108892f608c75f419dc4411b92cc87))

# [3.0.0](https://github.com/TestJG/nativescript-mtmobile-sqlite/compare/v2.0.0...v3.0.0) (2019-12-12)

### Bug Fixes

* full rewrite ([901b5c1](https://github.com/TestJG/nativescript-mtmobile-sqlite/commit/901b5c14c00af71c2f58927e05c15e34aade80d2))

# 2.0.0 (2019-12-05)

**Note:** Version bump only for package nativescript-mtmobile-sqlite
