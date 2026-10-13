#!/bin/sh
# Example "custom SQLite" provider: the vanilla amalgamation with FTS5 / JSON / RTREE, load_extension enabled and
# the sample extension compiled in.
#   Android: native/.build/custom/android/<abi>/libsqlite_custom.so, plus the loadable form of the extension,
#            libns_ext.so (for db.loadExtension). Usage: native/build-custom-sqlite.sh [abi...]  (default: arm64-v8a x86_64)
#   iOS:     native/build-custom-sqlite.sh ios -> native/.build/custom/ios/{NSCustomSqlite,NSSampleExt}.xcframework
#            (dynamic frameworks: the app embeds them and gives `engine: '@rpath/NSCustomSqlite.framework/NSCustomSqlite'`)
# SQLITE_SRC = folder with sqlite3.c / sqlite3.h / sqlite3ext.h (the amalgamation zip from sqlite.org)
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
SRC=${SQLITE_SRC:-$(ls -d "$ROOT"/native/.build/sqlite-src/sqlite-amalgamation-* | tail -1)}
ABIS=${*:-arm64-v8a x86_64}
DEFS="-DSQLITE_CORE -DSQLITE_THREADSAFE=1 -DSQLITE_DQS=0 -DSQLITE_DEFAULT_MEMSTATUS=0 -DSQLITE_ENABLE_FTS5 -DSQLITE_ENABLE_RTREE -DSQLITE_ENABLE_JSON1 -DSQLITE_ENABLE_MATH_FUNCTIONS -DSQLITE_ENABLE_STAT4 -DSQLITE_EXTRA_INIT=ns_ext_register"

if [ "$1" = ios ]; then
  OUT=$ROOT/native/.build/custom/ios
  MIN=13.0
  rm -rf "$OUT"; mkdir -p "$OUT"
  # framework <name> <install name> <sources> <extra clang flags>
  framework() {
    name=$1; shift; srcs=$1; shift; extra=$*
    for slice in "device iphoneos arm64" "simulator iphonesimulator arm64 x86_64"; do
      set -- $slice
      sl=$1; sdk=$2; shift 2
      case $sdk in iphoneos) minflag="-miphoneos-version-min=$MIN";; *) minflag="-mios-simulator-version-min=$MIN";; esac
      fw="$OUT/$sl/$name.framework"; mkdir -p "$fw"
      archs=""
      for arch in "$@"; do
        xcrun --sdk "$sdk" clang -arch "$arch" $minflag -dynamiclib -O2 -w -fPIC -I"$SRC" -I"$ROOT/native/ext" $extra \
          -install_name "@rpath/$name.framework/$name" -o "$OUT/$sl-$arch-$name" $srcs
        archs="$archs $OUT/$sl-$arch-$name"
      done
      xcrun lipo -create $archs -output "$fw/$name"
      rm -f $archs
      cat > "$fw/Info.plist" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>$name</string>
<key>CFBundleIdentifier</key><string>org.nativescript.$name</string>
<key>CFBundleName</key><string>$name</string>
<key>CFBundlePackageType</key><string>FMWK</string>
<key>CFBundleShortVersionString</key><string>1.0</string>
<key>CFBundleVersion</key><string>1</string>
<key>MinimumOSVersion</key><string>$MIN</string>
</dict></plist>
PL
    done
    rm -rf "$OUT/$name.xcframework"
    xcodebuild -create-xcframework -framework "$OUT/device/$name.framework" -framework "$OUT/simulator/$name.framework" -output "$OUT/$name.xcframework"
    rm -rf "$OUT/device" "$OUT/simulator"
  }
  framework NSCustomSqlite "$SRC/sqlite3.c $ROOT/native/ext/ns_ext.c $ROOT/native/ext/custom_init.c" $DEFS
  framework NSSampleExt "$ROOT/native/ext/ns_ext.c"
  du -sh "$OUT"/*.xcframework
  exit 0
fi

NDK=${ANDROID_NDK_HOME:-$(ls -d "$ANDROID_HOME"/ndk/* | sort -V | tail -1)}
OUT=$ROOT/native/.build/custom/android
CLANG_ARCH() { case $1 in arm64-v8a) echo aarch64-linux-android24;; x86_64) echo x86_64-linux-android24;; armeabi-v7a) echo armv7a-linux-androideabi24;; x86) echo i686-linux-android24;; esac; }
CC_BIN=$(ls -d "$NDK"/toolchains/llvm/prebuilt/*/bin)/clang
for abi in $ABIS; do
  T=$(CLANG_ARCH "$abi")
  mkdir -p "$OUT/$abi"
  "$CC_BIN" --target="$T" -shared -fPIC -O2 -o "$OUT/$abi/libsqlite_custom.so" \
    -I"$SRC" -I"$ROOT/native/ext" \
    $DEFS -DSQLITE_TEMP_STORE=3 \
    "$SRC/sqlite3.c" "$ROOT/native/ext/ns_ext.c" "$ROOT/native/ext/custom_init.c" -llog -lm
  "$CC_BIN" --target="$T" -shared -fPIC -O2 -o "$OUT/$abi/libns_ext.so" -I"$SRC" "$ROOT/native/ext/ns_ext.c"
done
ls -l "$OUT"/*/
