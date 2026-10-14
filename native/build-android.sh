#!/bin/sh
# Builds the prebuilt Android libraries into the packages' jniLibs/<abi>/ folders:
#   sqlite-core    libnssqlite_core.so  the C core (loads the SQLite the app chooses)
#   sqlite-napi    libnssqlite_napi.so  Node-API binding (NativeScript >= 9.1), links the core
#   sqlite-bridge  libnssqlite_jni.so   JNI bridge (any runtime, needed by NativeScript <= 8), links the core
# Usage: native/build-android.sh [abi...]      (default: all four)
# Needs ANDROID_HOME (NDK is picked from there, or set ANDROID_NDK_HOME) and cmake.
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
ABIS=${*:-arm64-v8a armeabi-v7a x86_64 x86}
NDK=${ANDROID_NDK_HOME:-$(ls -d "$ANDROID_HOME"/ndk/* | sort -V | tail -1)}
OUT=${NSSQLITE_BUILD_DIR:-$ROOT/native/.build/android}
for abi in $ABIS; do
  cmake -S "$ROOT/binding/android" -B "$OUT/$abi" -G "Unix Makefiles" \
    -DCMAKE_TOOLCHAIN_FILE="$NDK/build/cmake/android.toolchain.cmake" -DANDROID_ABI="$abi" -DANDROID_PLATFORM=android-24 \
    -DCMAKE_BUILD_TYPE=Release -DCMAKE_LIBRARY_OUTPUT_DIRECTORY="$OUT/lib/$abi"
  cmake --build "$OUT/$abi" -j8
  for lib in "core sqlite-core" "napi sqlite-napi" "jni sqlite-bridge"; do
    set -- $lib
    dest=$ROOT/packages/$2/platforms/android/jniLibs/$abi
    mkdir -p "$dest"
    cp "$OUT/lib/$abi/libnssqlite_$1.so" "$dest/"
  done
done
ls -l "$ROOT"/packages/sqlite-*/platforms/android/jniLibs/*/
