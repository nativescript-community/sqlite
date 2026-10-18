#!/bin/sh
# Builds libsqlite.so, the SQLite pinned in native/sqlite-version.sh (change it with native/update-sqlite.sh), into
# packages/sqlite-shared-engine/platforms/android/jniLibs/<abi>/. Fetches the amalgamation when missing.
# The soname is libsqlite.so: any other library of an app that ships that name (e.g. a map SDK) shares the one SQLite.
# Usage: native/build-sqlite.sh [abi...]      (default: all four)
#   SQLITE_OPTIONS overrides the compile options below.
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
ABIS=${*:-arm64-v8a armeabi-v7a x86_64 x86}
NDK=${ANDROID_NDK_HOME:-$(ls -d "$ANDROID_HOME"/ndk/* | sort -V | tail -1)}
SRC=$("$ROOT/native/fetch-sqlite.sh")
DEST=$ROOT/packages/sqlite-shared-engine/platforms/android/jniLibs
# Other libraries link this one, so stay close to a stock SQLite: THREADSAFE=1 is required (sqlite-core refuses 0), no DQS=0.
OPTIONS=${SQLITE_OPTIONS:--DSQLITE_THREADSAFE=1 -DSQLITE_TEMP_STORE=3 -DHAVE_USLEEP=1 -DSQLITE_ENABLE_FTS3 -DSQLITE_ENABLE_FTS3_PARENTHESIS -DSQLITE_ENABLE_FTS4 -DSQLITE_ENABLE_FTS5 -DSQLITE_ENABLE_RTREE -DSQLITE_ENABLE_MATH_FUNCTIONS -DSQLITE_ENABLE_COLUMN_METADATA -DSQLITE_ENABLE_DBSTAT_VTAB -DSQLITE_ENABLE_STAT4}
BIN=$(ls -d "$NDK"/toolchains/llvm/prebuilt/*/bin)
triple() { case $1 in arm64-v8a) echo aarch64-linux-android24;; x86_64) echo x86_64-linux-android24;; armeabi-v7a) echo armv7a-linux-androideabi24;; x86) echo i686-linux-android24;; esac; }
for abi in $ABIS; do
  mkdir -p "$DEST/$abi"
  # shellcheck disable=SC2086
  "$BIN/clang" --target="$(triple "$abi")" -shared -fPIC -O2 -I"$SRC" $OPTIONS \
    -ffunction-sections -fdata-sections -Wl,--gc-sections -Wl,--strip-all -Wl,-soname,libsqlite.so -Wl,-z,max-page-size=16384 \
    -o "$DEST/$abi/libsqlite.so" "$SRC/sqlite3.c" -lm
  "$BIN/llvm-readelf" -d "$DEST/$abi/libsqlite.so" | grep -q "SONAME.*\[libsqlite.so\]"
  "$BIN/llvm-nm" -D --defined-only "$DEST/$abi/libsqlite.so" | grep -q " T sqlite3_libversion$"
done
ls -l "$DEST"/*/
