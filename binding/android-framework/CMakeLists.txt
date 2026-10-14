cmake_minimum_required(VERSION 3.22)
project(nssqlite_framework C)

set(CMAKE_C_STANDARD 11)
set(CORE ${CMAKE_CURRENT_SOURCE_DIR}/../../core)

# libnssqlite_framework.so: sqlite3_* over android.database.sqlite (see shim.c). Only the sqlite3_* functions are exported.
add_library(nssqlite_framework SHARED shim.c ${CORE}/wire.c)
target_include_directories(nssqlite_framework PRIVATE ${CORE})
target_compile_options(nssqlite_framework PRIVATE -Wall -Wextra -Wno-unused-parameter -Os -fvisibility=hidden -ffunction-sections -fdata-sections)
target_link_libraries(nssqlite_framework PRIVATE log)
target_link_options(nssqlite_framework PRIVATE -Wl,-z,max-page-size=16384 -Wl,--gc-sections -Wl,--strip-all)
