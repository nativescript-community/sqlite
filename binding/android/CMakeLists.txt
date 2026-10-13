cmake_minimum_required(VERSION 3.22)
project(nssqlite_android C)

set(CMAKE_C_STANDARD 11)
set(CORE ${CMAKE_CURRENT_SOURCE_DIR}/../../core)
set(NAPI ${CMAKE_CURRENT_SOURCE_DIR}/../napi)

# libnssqlite.so: the C core plus the JNI bridge. No Node-API symbols, so it loads on every runtime.
add_library(nssqlite SHARED nssqlite_jni.c ${CORE}/wire.c ${CORE}/engine.c ${CORE}/db.c ${CORE}/provider.c)
target_include_directories(nssqlite PRIVATE ${CORE})
# the core API stays visible (NSSQLITE_API), everything else is hidden
target_compile_options(nssqlite PRIVATE -Wall -Wextra -Wno-unused-parameter -Os -fvisibility=hidden -ffunction-sections -fdata-sections)
target_link_libraries(nssqlite PRIVATE dl log)
target_link_options(nssqlite PRIVATE -Wl,-z,max-page-size=16384 -Wl,--gc-sections -Wl,--strip-all)

# libnssqlite_napi.so: the Node-API binding, only loaded by runtimes that provide napi_* (NativeScript >= 9.1).
# napi_* functions are resolved at runtime (napi_dyn.c): nothing is linked against the runtime, and the
# library does not depend on the runtime's library name or ABI. It links the core dynamically.
add_library(nssqlite_napi SHARED ${NAPI}/nssqlite_napi.c ${NAPI}/napi_dyn.c)
target_include_directories(nssqlite_napi PRIVATE ${NAPI} ${NAPI}/include ${CORE})
target_compile_options(nssqlite_napi PRIVATE -Wall -Wextra -Wno-unused-parameter -Os -fvisibility=hidden -ffunction-sections -fdata-sections)
target_link_libraries(nssqlite_napi PRIVATE nssqlite dl)
target_link_options(nssqlite_napi PRIVATE -Wl,--no-undefined -Wl,-z,max-page-size=16384 -Wl,--gc-sections -Wl,--strip-all)
