#!/bin/sh
# Makes sure the SQLite amalgamation pinned in native/sqlite-version.sh is in native/.build/sqlite-src/ and prints its folder.
# Downloads it from sqlite.org when missing and checks it against SQLITE_SHA256.
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
. "$ROOT/native/sqlite-version.sh"
SRC_DIR=$ROOT/native/.build/sqlite-src
# 3.53.4 -> 3530400, the number sqlite.org uses in its file names
NUM=$(echo "$SQLITE_VERSION" | awk -F. '{ printf "%d%02d%02d00", $1, $2, $3 }')
DIR=$SRC_DIR/sqlite-amalgamation-$NUM
if [ ! -f "$DIR/sqlite3.c" ]; then
  ZIP=${SQLITE_ZIP:-$SRC_DIR/sqlite-amalgamation-$NUM.zip}
  mkdir -p "$SRC_DIR"
  if [ ! -f "$ZIP" ]; then
    curl -fL -o "$ZIP" "https://www.sqlite.org/$SQLITE_YEAR/sqlite-amalgamation-$NUM.zip" >&2 ||
      { rm -f "$ZIP"; echo "fetch-sqlite: download failed, is SQLITE_YEAR right in native/sqlite-version.sh?" >&2; exit 1; }
  fi
  [ "$(shasum -a 256 "$ZIP" | cut -d' ' -f1)" = "$SQLITE_SHA256" ] || { echo "fetch-sqlite: $ZIP does not match SQLITE_SHA256" >&2; exit 1; }
  unzip -q -o "$ZIP" -d "$SRC_DIR"
fi
grep -q "#define SQLITE_VERSION *\"$SQLITE_VERSION\"" "$DIR/sqlite3.h" || { echo "fetch-sqlite: $DIR is not SQLite $SQLITE_VERSION" >&2; exit 1; }
echo "$DIR"
