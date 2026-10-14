#!/bin/sh
# Builds the Node-API binding for the host Node.js (used to run the TypeScript tests against a real SQLite).
# Output: native/.build/node/nssqlite.node
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT=${NSSQLITE_BUILD_DIR:-$ROOT/native/.build}/node
mkdir -p "$OUT"
CC=${CC:-cc}
case $(uname) in
  Darwin) LDFLAGS="-shared -undefined dynamic_lookup" ;;
  *) LDFLAGS="-shared -ldl -lpthread" ;;
esac
# NSSQLITE_V1_ONLY=1: no legacy napi_module_register at load, only the napi_register_module_v1 export (how QuickJS based runtimes load it)
[ -n "$NSSQLITE_V1_ONLY" ] && V1="-DNSSQLITE_NAPI_V1_ONLY"
$CC -std=gnu11 $V1 -O1 -g -fPIC -Wall -Wextra -Wno-unused-parameter $SANITIZE \
  -I"$ROOT/binding/napi/include" -I"$ROOT/binding/napi" -I"$ROOT/core" \
  "$ROOT"/core/wire.c "$ROOT"/core/engine.c "$ROOT"/core/db.c "$ROOT"/core/provider.c \
  "$ROOT"/binding/napi/nssqlite_napi.c "$ROOT"/binding/napi/napi_dyn.c \
  $LDFLAGS -o "$OUT/nssqlite.node"
echo "$OUT/nssqlite.node"
