#!/bin/sh
# Builds static xcframeworks (device + simulator) into packages/sqlite-core/platforms/ios/:
#   NSSqlite.xcframework      the C core and the Objective-C bridge (any runtime). SQLite is not included.
#   NSSqliteNapi.xcframework  the Node-API binding (inactive on runtimes without napi_*, NativeScript <= 8)
# Usage: native/build-ios.sh
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT=${NSSQLITE_BUILD_DIR:-$ROOT/native/.build/ios}
DEST=$ROOT/packages/sqlite-core/platforms/ios
MIN=13.0

# build_lib <product> "<sources>" "<extra clang flags>"  -> $OUT/<product>/{device,simulator}/lib<product>.a
build_lib() {
  product=$1; srcs=$2; extra=$3
  for slice in "device iphoneos arm64" "simulator iphonesimulator arm64 x86_64"; do
    set -- $slice
    name=$1; sdk=$2; shift 2
    sysroot=$(xcrun --sdk "$sdk" --show-sdk-path)
    case $sdk in iphoneos) minflag="-miphoneos-version-min=$MIN";; *) minflag="-mios-simulator-version-min=$MIN";; esac
    libs=""
    for arch in "$@"; do
      d="$OUT/$product/$name-$arch"; rm -rf "$d"; mkdir -p "$d"
      for src in $srcs; do
        xcrun --sdk "$sdk" clang -arch "$arch" -isysroot "$sysroot" $minflag -O2 -g0 -fobjc-arc -fmodules -I"$ROOT/core" \
          -std=gnu11 -Wall -Wextra -Wno-unused-parameter $extra -c "$src" -o "$d/$(basename "$src").o"
      done
      xcrun libtool -static -o "$d/lib$product.a" "$d"/*.o
      libs="$libs $d/lib$product.a"
    done
    mkdir -p "$OUT/$product/$name"
    xcrun lipo -create $libs -output "$OUT/$product/$name/lib$product.a"
  done
}

build_lib NSSqlite "$ROOT/core/wire.c $ROOT/core/engine.c $ROOT/core/db.c $ROOT/core/provider.c $ROOT/binding/ios/NSSqliteBridge.m" "-I$ROOT/binding/ios"
build_lib NSSqliteNapi "$ROOT/binding/napi/nssqlite_napi.c $ROOT/binding/napi/napi_dyn.c $ROOT/binding/ios/NSSqliteNapiLink.m" "-I$ROOT/binding/napi -I$ROOT/binding/napi/include"

HDR="$OUT/Headers"; rm -rf "$HDR"; mkdir -p "$HDR"
cp "$ROOT/binding/ios/NSSqliteBridge.h" "$ROOT/core/nssqlite.h" "$ROOT/core/provider.h" "$HDR/" # the last two are for static SQLite glue
cat > "$HDR/module.modulemap" <<'MM'
module NSSqlite {
    header "NSSqliteBridge.h"
    export *
}
MM
mkdir -p "$DEST"
rm -rf "$DEST/NSSqlite.xcframework" "$DEST/NSSqliteNapi.xcframework"
xcodebuild -create-xcframework \
  -library "$OUT/NSSqlite/device/libNSSqlite.a" -headers "$HDR" \
  -library "$OUT/NSSqlite/simulator/libNSSqlite.a" -headers "$HDR" \
  -output "$DEST/NSSqlite.xcframework"
xcodebuild -create-xcframework \
  -library "$OUT/NSSqliteNapi/device/libNSSqliteNapi.a" \
  -library "$OUT/NSSqliteNapi/simulator/libNSSqliteNapi.a" \
  -output "$DEST/NSSqliteNapi.xcframework"
du -sh "$DEST"/*.xcframework
