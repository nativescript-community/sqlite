package com.akylas.sqlite;

import android.os.Handler;
import android.os.Looper;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Thin Java side of the JNI bridge (runtimes without Node-API). Every method maps to one core function.
 *
 * Nothing crosses the JS boundary as an object on the hot path. The NativeScript runtime pins a global reference
 * for every Java object it hands to JS (or JS buffer it hands to Java) until the garbage collectors get to them, and
 * the process aborts when 51200 are alive at once, which a busy database reaches. So:
 *
 * - a request is a few numbers; the SQL and parameters are written by JS into this thread's request arena, one
 *   direct ByteBuffer created once;
 * - a result is delivered as {@link Callback#onResult} with numbers only; its bytes are in this thread's result arena
 *   (copied by JS right away), or fetched with {@link #takeBigData} when too large for the arena;
 * - requests are numbered by the caller, and one callback object serves all the requests of a thread.
 *
 * Results are posted to the Looper of the thread that made the call (the main Looper if it has none).
 */
public final class NativeSqlite {
    static {
        System.loadLibrary("nssqlite");
    }

    private NativeSqlite() {}

    /** Results larger than this are not copied to the result arena: see takeBigData. */
    public static final int RESULT_ARENA_SIZE = 512 * 1024;
    private static final int REQUEST_ARENA_SIZE = 64 * 1024;

    public interface Callback {
        /**
         * dataLen: the number of result bytes in the result arena, -1 when there is none, -2 when they are large
         * (call takeBigData). Call takeMessage when status != 0.
         */
        void onResult(long requestId, int status, boolean done, int dataLen, double changes, double lastInsertRowId);
    }

    /** What a thread needs: its callback, Looper and arenas. */
    private static final class ThreadState {
        Callback callback;
        Handler handler;
        ByteBuffer requestArena;
        ByteBuffer resultArena;
        // the result being delivered
        String message;
        ByteBuffer bigData;
        long bigPtr;
    }

    private static final ThreadLocal<ThreadState> THREAD = new ThreadLocal<ThreadState>() {
        @Override
        protected ThreadState initialValue() {
            ThreadState s = new ThreadState();
            Looper looper = Looper.myLooper();
            s.handler = new Handler(looper != null ? looper : Looper.getMainLooper());
            s.requestArena = ByteBuffer.allocateDirect(REQUEST_ARENA_SIZE);
            s.resultArena = ByteBuffer.allocateDirect(RESULT_ARENA_SIZE);
            return s;
        }
    };

    private static final ConcurrentHashMap<Long, ThreadState> pending = new ConcurrentHashMap<Long, ThreadState>();

    /** The callback that receives the results of the requests made by the calling thread (once per thread). */
    public static void setCallback(Callback callback) {
        THREAD.get().callback = callback;
    }

    /** This thread's request arena, to be wrapped once by JS. Replaced (and the old one dropped) when `minSize` is larger. */
    public static ByteBuffer requestArena(int minSize) {
        ThreadState s = THREAD.get();
        if (s.requestArena.capacity() < minSize) {
            int size = s.requestArena.capacity();
            while (size < minSize) size *= 2;
            s.requestArena = ByteBuffer.allocateDirect(size);
        }
        return s.requestArena;
    }

    /** This thread's result arena (RESULT_ARENA_SIZE bytes), to be wrapped once by JS. */
    public static ByteBuffer resultArena() {
        return THREAD.get().resultArena;
    }

    /** Valid inside onResult after a status != 0. */
    public static String takeMessage() {
        ThreadState s = THREAD.get();
        String m = s.message;
        s.message = null;
        return m;
    }

    /** Valid inside onResult after dataLen == -2: the result bytes, in native memory, freed by releaseBigData. */
    public static ByteBuffer takeBigData() {
        return THREAD.get().bigData;
    }

    public static void releaseBigData() {
        ThreadState s = THREAD.get();
        if (s.bigPtr != 0) {
            freeNative(s.bigPtr);
            s.bigPtr = 0;
            s.bigData = null;
        }
    }

    private static ThreadState register(long id) {
        ThreadState s = THREAD.get();
        if (s.callback == null) {
            throw new IllegalStateException("NativeSqlite.setCallback must be called by this thread first");
        }
        pending.put(id, s);
        return s;
    }

    /** Called from the native worker threads. */
    static void dispatch(final long id, final int status, final boolean done, ByteBuffer data, final long dataPtr, final String message, final double changes, final double rowId) {
        final ThreadState t = done ? pending.remove(id) : pending.get(id);
        if (t == null) {
            if (dataPtr != 0) freeNative(dataPtr);
            return;
        }
        final ByteBuffer bytes = data != null ? data.order(ByteOrder.LITTLE_ENDIAN) : null;
        t.handler.post(new Runnable() {
            @Override
            public void run() {
                int dataLen = -1;
                if (bytes != null) {
                    int n = bytes.capacity();
                    if (n <= RESULT_ARENA_SIZE) {
                        ByteBuffer arena = t.resultArena;
                        arena.clear();
                        bytes.position(0);
                        arena.put(bytes);
                        dataLen = n;
                    } else {
                        t.bigData = bytes;
                        t.bigPtr = dataPtr;
                        dataLen = -2;
                    }
                }
                t.message = message;
                try {
                    t.callback.onResult(id, status, done, dataLen, changes, rowId);
                } finally {
                    t.message = null;
                    if (dataLen == -2) {
                        releaseBigData(); // JS already copied or finished with it
                    } else if (dataPtr != 0) {
                        freeNative(dataPtr);
                    }
                }
            }
        });
    }

    // ---- engines ----
    /** library == null uses the sqlite3 symbols already in the process. Throws RuntimeException. */
    public static native long engine(String library);
    public static native String engineVersion(long engine);
    public static native boolean engineCanLoadExtensions(long engine);
    /** initFn is the address of a statically linked extension entry point. Returns 0 on success. */
    public static native int engineAutoExtension(long engine, long initFn);

    // ---- database ----
    private static native long nOpen(long engine, String path, int flags, int busyMs, boolean wal, String initSql, long id);
    private static native int nExec(long db, int tx, ByteBuffer arena, int sqlLen, int paramsLen, int flags, int chunkRows, long id);
    private static native int nBatch(long db, int tx, ByteBuffer arena, int len, int flags, long id);
    private static native int nTxBegin(long db, int mode, long id);
    private static native int nTxEnd(long db, int tx, boolean commit, long id);
    private static native int nLoadExtension(long db, String path, String entry, long id);
    private static native int nClose(long db, long id);
    public static native void release(long db);
    static native void freeNative(long ptr);

    /** Returns the db handle immediately; the result of request `id` reports the open. Throws RuntimeException. */
    public static long open(long engine, String path, int flags, int busyMs, boolean wal, String initSql, long id) {
        register(id);
        try {
            return nOpen(engine, path, flags, busyMs, wal, initSql, id);
        } catch (RuntimeException e) {
            pending.remove(id);
            throw e;
        }
    }

    /** The SQL (UTF-8, sqlLen bytes) then the parameters (paramsLen bytes) are at the start of the request arena. */
    public static int exec(long db, int tx, int sqlLen, int paramsLen, int flags, int chunkRows, long id) {
        ThreadState s = register(id);
        int rc = nExec(db, tx, s.requestArena, sqlLen, paramsLen, flags, chunkRows, id);
        if (rc != 0) pending.remove(id);
        return rc;
    }

    /** The batch request (len bytes) is at the start of the request arena. */
    public static int batch(long db, int tx, int len, int flags, long id) {
        ThreadState s = register(id);
        int rc = nBatch(db, tx, s.requestArena, len, flags, id);
        if (rc != 0) pending.remove(id);
        return rc;
    }

    /** Returns the transaction id, 0 on error. */
    public static int txBegin(long db, int mode, long id) {
        register(id);
        int tx = nTxBegin(db, mode, id);
        if (tx == 0) pending.remove(id);
        return tx;
    }

    public static int txEnd(long db, int tx, boolean commit, long id) {
        register(id);
        int rc = nTxEnd(db, tx, commit, id);
        if (rc != 0) pending.remove(id);
        return rc;
    }

    public static int loadExtension(long db, String path, String entry, long id) {
        register(id);
        int rc = nLoadExtension(db, path, entry, id);
        if (rc != 0) pending.remove(id);
        return rc;
    }

    public static int close(long db, long id) {
        register(id);
        int rc = nClose(db, id);
        if (rc != 0) pending.remove(id);
        return rc;
    }
}
