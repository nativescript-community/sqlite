# nssqlite spike app

NativeScript 9.1 app exercising the Node-API addon (`binding/napi/spike_addon.c`) and the SQLite provider
loader (`core/provider.c`). Run output is logged with the `[SPIKE]` prefix.

Created outside the repo (the root yarn config breaks `ns create`); copy the folder out to run it:

1. `npm i` in the copy, then `npx nativescript@9.1.2 platform add android@9.1.1` / `ios`.
2. Android: build the addon with `binding/napi/build-android.sh <out> arm64-v8a`, copy `libnssqlite.so` and the
   androidx `libsqliteJni.so` (from `androidx.sqlite:sqlite-bundled-android` aar) to
   `App_Resources/Android/src/main/jniLibs/<abi>/`. `app.gradle` already adds that dir to `jniLibs.srcDirs`.
3. iOS: `App_Resources/iOS/Podfile` points at `NSSqlite.podspec` at the repo root (adjust the path). Use
   `export LANG=en_US.UTF-8` or CocoaPods crashes, and `ns run ios --clean` after native source changes.
4. Use the published CLI (`npx nativescript@9.1.2`): the local dev CLI 9.2.1 fails building `@nativescript/core`
   on Android ("Unsupported value: 36", vendor/gradle-plugin passes compileSdk as a string).
