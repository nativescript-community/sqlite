# Example: carrying your own SQLite

The nssqlite plugin ships no SQLite. This folder shows the iOS side of "the app (or one of its plugins) provides it":

```sh
native/build-custom-sqlite.sh ios      # builds NSCustomSqlite.xcframework (SQLite + FTS5/JSON/RTREE + a compiled-in extension)
                                       # and NSSampleExt.xcframework (the same extension, loadable)
cp -R native/.build/custom/ios/*.xcframework spike/custom-sqlite-plugin/platforms/ios/
```

Add this folder as a dependency of the app: the CLI embeds and signs the frameworks. Because the framework is linked into
the app, the default engine (`null`, the SQLite of the process) becomes this build. `engine: '/usr/lib/libsqlite3.dylib'` is
still the system one, `engine: '@rpath/NSCustomSqlite.framework/NSCustomSqlite'` is this one explicitly.

Android: `native/build-custom-sqlite.sh` builds `libsqlite_custom.so` and `libns_ext.so` (`.build/custom/android/<abi>`); the app
packages them in `jniLibs` and uses `engine: 'libsqlite_custom.so'`. The device tests are `spike/nssqlite-spike/app/engine-test.ts`.
