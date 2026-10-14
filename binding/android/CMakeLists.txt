cmake_minimum_required(VERSION 3.22)
project(nssqlite_android C)

set(CMAKE_C_STANDARD 11)
set(CORE ${CMAKE_CURRENT_SOURCE_DIR}/../../core)
set(NAPI ${CMAKE_CURRENT_SOURCE_DIR}/../napi)

set(COMMON_FLAGS -Wall -Wextra -Wno-unused-parameter -Os -fvisibility=hidden -ffunction-sections -fdata-sections)

# libnssqlite_core.so (package sqlite-core): the C core. It loads the SQLite the app chooses; the bindings link it.
# The core API stays visible (NSSQLITE_API), everything else is hidden.
add_library(nssqlite_core SHARED ${CORE}/wire.c ${CORE}/engine.c ${CORE}/db.c ${CORE}/provider.c)
target_include_directories(nssqlite_core PRIVATE ${CORE})
target_compile_options(nssqlite_core PRIVATE ${COMMON_FLAGS})
target_link_libraries(nssqlite_core PRIVATE dl log)
target_link_options(nssqlite_core PRIVATE -Wl,-z,max-page-size=16384 -Wl,--gc-sections -Wl,--strip-all)

# libnssqlite_napi.so (package sqlite-napi): the Node-API binding, only loaded by runtimes that provide napi_*
# (NativeScript >= 9.1). napi_* functions are resolved at runtime (napi_dyn.c): nothing is linked against the runtime,
# and the library does not depend on the runtime's library name or ABI.
add_library(nssqlite_napi SHARED ${NAPI}/nssqlite_napi.c ${NAPI}/napi_dyn.c)
target_include_directories(nssqlite_napi PRIVATE ${NAPI} ${NAPI}/include ${CORE})
target_compile_options(nssqlite_napi PRIVATE ${COMMON_FLAGS})
target_link_libraries(nssqlite_napi PRIVATE nssqlite_core dl log)
target_link_options(nssqlite_napi PRIVATE -Wl,--no-undefined -Wl,-z,max-page-size=16384 -Wl,--gc-sections -Wl,--strip-all)

# libnssqlite_jni.so (package sqlite-bridge): the JNI bridge for runtimes without Node-API (NativeScript <= 8).
# No Node-API symbols, so it loads on every runtime.
add_library(nssqlite_jni SHARED nssqlite_jni.c)
target_include_directories(nssqlite_jni PRIVATE ${CORE})
target_compile_options(nssqlite_jni PRIVATE ${COMMON_FLAGS})
target_link_libraries(nssqlite_jni PRIVATE nssqlite_core dl log)
target_link_options(nssqlite_jni PRIVATE -Wl,--no-undefined -Wl,-z,max-page-size=16384 -Wl,--gc-sections -Wl,--strip-all)
