#!/bin/sh
# Runs the TypeScript tests in Node, against the real C core through the Node-API binding.
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
BUILD=${NSSQLITE_BUILD_DIR:-$ROOT/native/.build}
"$ROOT/native/build-node.sh" > /dev/null
rm -rf "${BUILD:?}/ts-tests"
"$ROOT/node_modules/.bin/tsc" -p "$ROOT/src/sqlite/tests/tsconfig.json" --outDir "$BUILD/ts-tests"
EXT=$("$ROOT/native/build-ext.sh" || true)
NSSQLITE_EXT_ENGINE=${EXT%%|*} NSSQLITE_EXT_LIB=${EXT##*|} NSSQLITE_NODE_ADDON="$BUILD/node/nssqlite.node" node --test "$BUILD"/ts-tests/tests/*.test.js
