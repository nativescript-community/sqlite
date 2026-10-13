#!/bin/sh
# Builds libnssqlite_framework.so (the sqlite3_* shim over android.database.sqlite) into
# packages/sqlite-android-framework/platforms/android/jniLibs/<abi>/.
# Usage: native/build-framework.sh [abi...]      (default: all four)
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
ABIS=${*:-arm64-v8a armeabi-v7a x86_64 x86}
NDK=${ANDROID_NDK_HOME:-$(ls -d "$ANDROID_HOME"/ndk/* | sort -V | tail -1)}
OUT=${NSSQLITE_BUILD_DIR:-$ROOT/native/.build}/framework
DEST=$ROOT/packages/sqlite-android-framework/platforms/android/jniLibs
for abi in $ABIS; do
  cmake -S "$ROOT/binding/android-framework" -B "$OUT/$abi" -G "Unix Makefiles" \
    -DCMAKE_TOOLCHAIN_FILE="$NDK/build/cmake/android.toolchain.cmake" -DANDROID_ABI="$abi" -DANDROID_PLATFORM=android-24 \
    -DCMAKE_BUILD_TYPE=Release -DCMAKE_LIBRARY_OUTPUT_DIRECTORY="$OUT/lib/$abi"
  cmake --build "$OUT/$abi" -j8
  mkdir -p "$DEST/$abi"
  cp "$OUT/lib/$abi/libnssqlite_framework.so" "$DEST/$abi/"
done
ls -l "$DEST"/*/
