import { Backend } from './backend';

/** The binding to use on this platform: Node-API when the runtime has it, otherwise the JNI / Objective-C bridge. */
export function loadBackend(prefer: 'auto' | 'napi' | 'bridge'): Backend;
/** Makes a database path usable: Android bare names go to the databases folder, parent folders are created. */
export function resolveDatabasePath(path: string): string;
/** Deletes a database file and its -wal / -shm / -journal files. Returns true when the database file existed. */
export function deleteDatabaseFiles(path: string): boolean;
