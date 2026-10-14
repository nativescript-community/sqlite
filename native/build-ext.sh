#!/bin/sh
# Builds the sample extension (native/ext/ns_ext.c) as a loadable library for the host, next to a SQLite that can load it.
# Prints "<engine library>|<extension library>" on success, nothing when the host has no SQLite with headers and
# extension loading (Apple's system SQLite cannot load extensions: use `brew install sqlite`).
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT=${NSSQLITE_BUILD_DIR:-$ROOT/native/.build}
case "$(uname)" in
  Darwin) PREFIX=${SQLITE_PREFIX:-$(brew --prefix sqlite 2>/dev/null)}; LIB=libsqlite3.dylib; EXT=libns_ext.dylib; FLAGS="-dynamiclib" ;;
  *) PREFIX=${SQLITE_PREFIX:-/usr}; LIB=libsqlite3.so.0; EXT=libns_ext.so; FLAGS="-shared -fPIC" ;;
esac
INC=${SQLITE_INCLUDE:-$PREFIX/include}
[ -f "$INC/sqlite3ext.h" ] || exit 0
[ -f "$PREFIX/lib/$LIB" ] || exit 0
mkdir -p "$OUT"
/usr/bin/clang $FLAGS -O2 -I"$INC" -o "$OUT/$EXT" "$ROOT/native/ext/ns_ext.c" || exit 0
echo "$PREFIX/lib/$LIB|$OUT/$EXT"
