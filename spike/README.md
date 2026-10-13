# nssqlite spike app

NativeScript 9.1 app that exercises the plugin's two bindings on top of the C core:

- `app/napi-test.ts`  Node-API binding used directly from JS (also from a Worker, `app/worker-test.ts`)
- `app/bridge-test.ts` JNI / Objective-C bridge binding (what NativeScript <= 8 uses)
- `app/codec.ts`      minimal TypeScript codec for the wire format (the plugin's real codec replaces it)

Output is logged with the `[NAPI]` / `[BRIDGE]` prefixes. The app consumes the plugin like an app would:
from an `npm pack` tarball, so the prebuilt binaries in `packages/sqlite-core/platforms` are what gets tested.

## Run

`ns create` fails inside this repo (the root yarn config), so copy this folder out first.

```sh
export ANDROID_HOME=~/Library/Android/sdk LANG=en_US.UTF-8
native/build-android.sh && native/build-ios.sh       # prebuilt libs into packages/sqlite-core/platforms
(cd packages/sqlite-core && npm pack --pack-destination /tmp/pack)
# in the copied app: point the @nativescript-community/sqlite dependency at the tarball, then
yarn install
ns run android --clean      # --clean after every native change, the CLI does not notice it otherwise
ns run ios --clean
```

Notes:
- The app uses yarn 4 (`packageManager`, `.yarnrc.yml`) because the CLI is configured for yarn2.
- Android provider: the app ships androidx `libsqliteJni.so` (`App_Resources/Android/src/main/jniLibs/<abi>`, added to
  `jniLibs.srcDirs` in `app.gradle`) and the tests call `engine("libsqliteJni.so")`. iOS uses the system SQLite.
- `before-plugins.gradle` sets `compileSdk`/`targetSdk` to 36.

## Packages and engines

The plugin is two packages: `packages/sqlite-core` (no SQLite, no dependency; the prebuilt binaries live in its `platforms`) and
`packages/sqlite` (core + default engine: androidx on Android, process SQLite on iOS). `app/api-test.ts`, `orm-test.ts` and
`engine-test.ts` run against `sqlite`; `app/bare-test.ts` runs against `sqlite-core` alone (replace `main-page.ts` and the
dependency to try it). Engine tests need the custom builds: see `spike/custom-sqlite-plugin/README.md`.
