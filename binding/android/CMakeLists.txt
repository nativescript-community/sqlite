cmake_minimum_required(VERSION 3.22)
project(nssqlite_android C)

# libnssqlite.so: the C core plus the JNI bridge. No Node-API symbols, so it loads on every runtime.
set(CMAKE_C_STANDARD 11)
set(CORE ${CMAKE_CURRENT_SOURCE_DIR}/../../core)
add_library(nssqlite SHARED nssqlite_jni.c ${CORE}/wire.c ${CORE}/engine.c ${CORE}/db.c ${CORE}/provider.c)
target_include_directories(nssqlite PRIVATE ${CORE})
# core symbols stay visible (the napi library links against them), everything else is hidden
target_compile_options(nssqlite PRIVATE -Wall -Wextra -Wno-unused-parameter -Os -fvisibility=hidden -ffunction-sections -fdata-sections)
target_link_libraries(nssqlite PRIVATE dl log)
# 16 KB page size alignment (Android 15+), drop unused code, strip
target_link_options(nssqlite PRIVATE -Wl,-z,max-page-size=16384 -Wl,--gc-sections -Wl,--strip-all)
