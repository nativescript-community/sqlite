# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## [4.0.0](https://github.com/nativescript-community/sqlite/compare/v3.5.9...v4.0.0) (2026-10-14)

### Notes

New package in 4.0.0, see [MIGRATION.md](https://github.com/nativescript-community/sqlite/blob/master/MIGRATION.md) for the move from the 3.x plugin.

### Features

* **android-framework:** configurable cursor window (default 16 MB), clear error for a row that does not fit ([a21b8ca](https://github.com/nativescript-community/sqlite/commit/a21b8ca55d9da4ed1e9ad1192e0f54133d898ecd))
* split JNI / Objective-C bridges and the Node-API binding into sqlite-bridge and sqlite-napi ([c206afc](https://github.com/nativescript-community/sqlite/commit/c206afcf709a76106b188e5538ad06d893546b6b))
* sqlite-android-framework, the platform SQLite (android.database.sqlite) as an engine (prototype) ([9cf7dc7](https://github.com/nativescript-community/sqlite/commit/9cf7dc742dc32d373d0ef50c120cab6e0fe8497f))

### Bug Fixes

* do not need TextDecoder / TextEncoder when the codec module loads ([ce18eea](https://github.com/nativescript-community/sqlite/commit/ce18eead8366cd7151767fe843ccee6528c1beb9))
