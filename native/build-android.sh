#!/bin/sh
# Builds the prebuilt Android libraries into packages/sqlite-core/platforms/android/jniLibs/<abi>/.
#   libnssqlite.so       core + JNI bridge (loads on every runtime)
#   libnssqlite_napi.so  Node-API binding (loaded only by NativeScript >= 9.1 runtimes)
# Usage: native/build-android.sh [abi...]      (default: all four)
# Needs ANDROID_HOME (NDK is picked from there, or set ANDROID_NDK_HOME) and cmake.
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
ABIS=${*:-arm64-v8a armeabi-v7a x86_64 x86}
NDK=${ANDROID_NDK_HOME:-$(ls -d "$ANDROID_HOME"/ndk/* | sort -V | tail -1)}
OUT=${NSSQLITE_BUILD_DIR:-$ROOT/native/.build/android}
DEST=$ROOT/packages/sqlite-core/platforms/android/jniLibs
for abi in $ABIS; do
  cmake -S "$ROOT/binding/android" -B "$OUT/$abi" -G "Unix Makefiles" \
    -DCMAKE_TOOLCHAIN_FILE="$NDK/build/cmake/android.toolchain.cmake" -DANDROID_ABI="$abi" -DANDROID_PLATFORM=android-24 \
    -DCMAKE_BUILD_TYPE=Release -DCMAKE_LIBRARY_OUTPUT_DIRECTORY="$OUT/lib/$abi"
  cmake --build "$OUT/$abi" -j8
  mkdir -p "$DEST/$abi"
  cp "$OUT/lib/$abi/libnssqlite.so" "$OUT/lib/$abi/libnssqlite_napi.so" "$DEST/$abi/"
done
ls -l "$DEST"/*/
