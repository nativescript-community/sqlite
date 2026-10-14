#!/bin/sh
# Builds static xcframeworks (device, simulator, Mac Catalyst) into the packages' platforms/ios folders:
#   sqlite-core    NSSqliteCore.xcframework    the C core. SQLite is not included. Its headers are for static SQLite glue.
#   sqlite-napi    NSSqliteNapi.xcframework    the Node-API binding (inactive on runtimes without napi_*, NativeScript <= 8)
#   sqlite-bridge  NSSqliteBridge.xcframework  the Objective-C bridge (any runtime, needed by NativeScript <= 8)
# The bindings reference the core: an app links the packages it installs together (the bindings depend on sqlite-core).
# Usage: native/build-ios.sh
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT=${NSSQLITE_BUILD_DIR:-$ROOT/native/.build/ios}
PK=$ROOT/packages
MIN=13.0
CATALYST_MIN=13.1

# build_lib <product> "<sources>" "<extra clang flags>"  -> $OUT/<product>/{device,simulator}/lib<product>.a
build_lib() {
  product=$1; srcs=$2; extra=$3
  for slice in "device iphoneos arm64" "simulator iphonesimulator arm64 x86_64" "catalyst macosx arm64 x86_64"; do
    set -- $slice
    name=$1; sdk=$2; shift 2
    sysroot=$(xcrun --sdk "$sdk" --show-sdk-path)
    libs=""
    for arch in "$@"; do
      case $name in
        device) target="-arch $arch -miphoneos-version-min=$MIN";;
        simulator) target="-arch $arch -mios-simulator-version-min=$MIN";;
        # Mac Catalyst: the macOS SDK with the iOS support frameworks and headers
        catalyst) target="-target $arch-apple-ios$CATALYST_MIN-macabi -iframework $sysroot/System/iOSSupport/System/Library/Frameworks -isystem $sysroot/System/iOSSupport/usr/include";;
      esac
      d="$OUT/$product/$name-$arch"; rm -rf "$d"; mkdir -p "$d"
      for src in $srcs; do
        xcrun --sdk "$sdk" clang $target -isysroot "$sysroot" -O2 -g0 -fobjc-arc -fmodules -I"$ROOT/core" \
          -std=gnu11 -Wall -Wextra -Wno-unused-parameter $extra -c "$src" -o "$d/$(basename "$src").o"
      done
      xcrun libtool -static -o "$d/lib$product.a" "$d"/*.o
      libs="$libs $d/lib$product.a"
    done
    mkdir -p "$OUT/$product/$name"
    xcrun lipo -create $libs -output "$OUT/$product/$name/lib$product.a"
  done
}

build_lib NSSqliteCore "$ROOT/core/wire.c $ROOT/core/engine.c $ROOT/core/db.c $ROOT/core/provider.c" ""
build_lib NSSqliteNapi "$ROOT/binding/napi/nssqlite_napi.c $ROOT/binding/napi/napi_dyn.c $ROOT/binding/ios/NSSqliteNapiLink.m" "-I$ROOT/binding/napi -I$ROOT/binding/napi/include"
build_lib NSSqliteBridge "$ROOT/binding/ios/NSSqliteBridge.m" "-I$ROOT/binding/ios"

CORE_HDR="$OUT/HeadersCore"; rm -rf "$CORE_HDR"; mkdir -p "$CORE_HDR"
cp "$ROOT/core/nssqlite.h" "$ROOT/core/nssqlite_wire.h" "$ROOT/core/provider.h" "$CORE_HDR/" # for static SQLite glue (native/provider)
BRIDGE_HDR="$OUT/HeadersBridge"; rm -rf "$BRIDGE_HDR"; mkdir -p "$BRIDGE_HDR"
cp "$ROOT/binding/ios/NSSqliteBridge.h" "$BRIDGE_HDR/"
cat > "$BRIDGE_HDR/module.modulemap" <<'MM'
module NSSqlite {
    header "NSSqliteBridge.h"
    export *
}
MM

make_xcframework() { # <package> <product> [headers]
  pkg=$1; product=$2; hdr=$3
  dest=$PK/$pkg/platforms/ios
  mkdir -p "$dest"
  rm -rf "$dest/$product.xcframework"
  if [ -n "$hdr" ]; then
    xcodebuild -create-xcframework -library "$OUT/$product/device/lib$product.a" -headers "$hdr" \
      -library "$OUT/$product/simulator/lib$product.a" -headers "$hdr" \
      -library "$OUT/$product/catalyst/lib$product.a" -headers "$hdr" -output "$dest/$product.xcframework"
  else
    xcodebuild -create-xcframework -library "$OUT/$product/device/lib$product.a" \
      -library "$OUT/$product/simulator/lib$product.a" \
      -library "$OUT/$product/catalyst/lib$product.a" -output "$dest/$product.xcframework"
  fi
}
make_xcframework sqlite-core NSSqliteCore "$CORE_HDR"
make_xcframework sqlite-napi NSSqliteNapi ""
make_xcframework sqlite-bridge NSSqliteBridge "$BRIDGE_HDR"
du -sh "$PK"/sqlite-*/platforms/ios/*.xcframework
