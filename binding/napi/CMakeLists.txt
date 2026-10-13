cmake_minimum_required(VERSION 3.22)
project(nssqlite C)

# NS_NAPI_INCLUDE: dir containing node_api.h (vendored copy in include/)
# NS_RUNTIME_LIB:  libNativeScript.so for this ABI, used only to satisfy the linker (never shipped)
set(CMAKE_C_STANDARD 11)
add_library(nssqlite SHARED spike_addon.c ../../core/provider.c)
target_include_directories(nssqlite PRIVATE ${NS_NAPI_INCLUDE})
target_link_libraries(nssqlite PRIVATE ${NS_RUNTIME_LIB} dl log)
target_compile_options(nssqlite PRIVATE -Wall -Wextra -Os -fvisibility=hidden)
# 16 KB page-size aligned for Android 15+
target_link_options(nssqlite PRIVATE -Wl,-z,max-page-size=16384 -Wl,--gc-sections)
