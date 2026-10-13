#!/bin/sh
# Build the spike addon for Android with the NDK. Usage: build-android.sh <out-dir> [abi...]
# Needs: ANDROID_HOME, a NativeScript android runtime aar extracted to $NS_RT (for headers + link stub):
#   unzip node_modules/@nativescript/android/framework/app/libs/runtime-libs/nativescript-optimized.aar -d $NS_RT
set -e
OUT=${1:?out dir}; shift
ABIS=${*:-arm64-v8a x86_64}
NDK=${ANDROID_NDK_HOME:-$(ls -d "$ANDROID_HOME"/ndk/* | sort -V | tail -1)}
: "${NS_RT:?path to extracted runtime aar}"
cd "$(dirname "$0")"
for abi in $ABIS; do
  cmake -S . -B "$OUT/build-$abi" -G "Unix Makefiles" \
    -DCMAKE_TOOLCHAIN_FILE="$NDK/build/cmake/android.toolchain.cmake" -DANDROID_ABI="$abi" -DANDROID_PLATFORM=android-24 \
    -DCMAKE_BUILD_TYPE=Release -DNS_NAPI_INCLUDE="$PWD/include" -DNS_RUNTIME_LIB="$NS_RT/jni/$abi/libNativeScript.so" \
    -DCMAKE_LIBRARY_OUTPUT_DIRECTORY="$OUT/lib/$abi"
  cmake --build "$OUT/build-$abi" -j8
done
