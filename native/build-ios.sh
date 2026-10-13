#!/bin/sh
# Builds packages/sqlite/platforms/ios/NSSqlite.xcframework (static, device + simulator):
# the C core and the Objective-C bridge. SQLite itself is not included.
# Usage: native/build-ios.sh
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT=${NSSQLITE_BUILD_DIR:-$ROOT/native/.build/ios}
DEST=$ROOT/packages/sqlite/platforms/ios
MIN=13.0
SRCS="$ROOT/core/wire.c $ROOT/core/engine.c $ROOT/core/db.c $ROOT/core/provider.c $ROOT/binding/ios/NSSqliteBridge.m"

build_slice() { # name sdk arch...
  name=$1; sdk=$2; shift 2
  sysroot=$(xcrun --sdk "$sdk" --show-sdk-path)
  case $sdk in iphoneos) minflag="-miphoneos-version-min=$MIN";; *) minflag="-mios-simulator-version-min=$MIN";; esac
  libs=""
  for arch in "$@"; do
    d="$OUT/$name-$arch"; rm -rf "$d"; mkdir -p "$d"
    for src in $SRCS; do
      xcrun --sdk "$sdk" clang -arch "$arch" -isysroot "$sysroot" $minflag -O2 -g0 -fobjc-arc -fmodules -I"$ROOT/core" -I"$ROOT/binding/ios" \
        -std=gnu11 -Wall -Wextra -Wno-unused-parameter -c "$src" -o "$d/$(basename "$src").o"
    done
    xcrun libtool -static -o "$d/libNSSqlite.a" "$d"/*.o
    libs="$libs $d/libNSSqlite.a"
  done
  mkdir -p "$OUT/$name"
  xcrun lipo -create $libs -output "$OUT/$name/libNSSqlite.a"
}

build_slice device iphoneos arm64
build_slice simulator iphonesimulator arm64 x86_64

HDR="$OUT/Headers"; rm -rf "$HDR"; mkdir -p "$HDR"
cp "$ROOT/binding/ios/NSSqliteBridge.h" "$HDR/"
cat > "$HDR/module.modulemap" <<'MM'
module NSSqlite {
    header "NSSqliteBridge.h"
    export *
}
MM
rm -rf "$DEST/NSSqlite.xcframework"
mkdir -p "$DEST"
xcodebuild -create-xcframework \
  -library "$OUT/device/libNSSqlite.a" -headers "$HDR" \
  -library "$OUT/simulator/libNSSqlite.a" -headers "$HDR" \
  -output "$DEST/NSSqlite.xcframework"
du -sh "$DEST/NSSqlite.xcframework"
