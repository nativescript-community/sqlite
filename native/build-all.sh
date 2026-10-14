#!/bin/sh
# Builds the prebuilt native libraries of the packages: Android (jniLibs) everywhere the NDK is, iOS (xcframeworks) on macOS.
# They are not tracked in git, a package published without them has no native code.
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)

if [ -z "$ANDROID_NDK_HOME" ] && ! ls -d "$ANDROID_HOME"/ndk/* > /dev/null 2>&1; then
  echo "build-all: the Android NDK is needed (set ANDROID_HOME or ANDROID_NDK_HOME)" >&2
  exit 1
fi
"$ROOT/native/build-android.sh"

if [ "$(uname)" = "Darwin" ]; then
  "$ROOT/native/build-ios.sh"
else
  echo "build-all: not on macOS, the iOS xcframeworks are NOT built: packages published from here have no iOS native code" >&2
fi
