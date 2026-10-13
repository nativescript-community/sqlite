package com.akylas.sqlite;

import android.os.Handler;
import android.os.Looper;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;

/**
 * Thin Java side of the JNI bridge (runtimes without Node-API). Every method maps to one core
 * function. The caller passes a {@link Callback}; its methods run on the Looper of the thread that
 * made the call (the main thread when that thread has no Looper).
 *
 * Result buffers are direct ByteBuffers over native memory: call {@link Result#release()} once the
 * bytes were decoded (copy blobs first).
 */
public final class NativeSqlite {
    static {
        System.loadLibrary("nssqlite");
    }

    private NativeSqlite() {}

    public interface Callback {
        void onResult(Result result);
    }

    public static final class Result {
        public final int status;
        public final boolean done;
        /** Rows block / batch block, or null. Valid until release(). */
        public final ByteBuffer data;
        public final String message;
        public final long changes;
        public final long lastInsertRowId;
        private long ptr;

        Result(int status, boolean done, ByteBuffer data, long ptr, String message, long changes, long lastInsertRowId) {
            this.status = status;
            this.done = done;
            this.data = data;
            this.ptr = ptr;
            this.message = message;
            this.changes = changes;
            this.lastInsertRowId = lastInsertRowId;
        }

        // Methods rather than fields: the NativeScript runtime converts a ByteBuffer returned from a
        // method call to an ArrayBuffer.
        public ByteBuffer getData() {
            return data;
        }

        public int getStatus() {
            return status;
        }

        public boolean isDone() {
            return done;
        }

        public String getMessage() {
            return message;
        }

        public long getChanges() {
            return changes;
        }

        public long getLastInsertRowId() {
            return lastInsertRowId;
        }

        public void release() {
            if (ptr != 0) {
                freeNative(ptr);
                ptr = 0;
            }
        }
    }

    /** Posts results to the Looper captured at call time. */
    private static final class Target {
        final Callback callback;
        final Handler handler;

        Target(Callback callback) {
            this.callback = callback;
            Looper looper = Looper.myLooper();
            this.handler = new Handler(looper != null ? looper : Looper.getMainLooper());
        }
    }

    // called from the native worker thread
    static void dispatch(Object ctx, int status, boolean done, ByteBuffer data, long dataPtr, String message, long changes, long rowId) {
        final Target t = (Target) ctx;
        ByteBuffer buf = data != null ? data.order(ByteOrder.LITTLE_ENDIAN) : null;
        final Result result = new Result(status, done, buf, dataPtr, message, changes, rowId);
        t.handler.post(new Runnable() {
            @Override
            public void run() {
                t.callback.onResult(result);
            }
        });
    }

    private static ByteBuffer direct(ByteBuffer b) {
        if (b == null || b.isDirect()) {
            return b;
        }
        ByteBuffer d = ByteBuffer.allocateDirect(b.remaining());
        d.put(b.duplicate());
        d.flip();
        return d;
    }

    // ---- engines ----
    /** library == null uses the sqlite3 symbols already in the process. Throws RuntimeException. */
    public static native long engine(String library);
    public static native String engineVersion(long engine);
    public static native boolean engineCanLoadExtensions(long engine);
    /** initFn is the address of a statically linked extension entry point. Returns 0 on success. */
    public static native int engineAutoExtension(long engine, long initFn);

    // ---- database ----
    private static native long nOpen(long engine, String path, int flags, int busyMs, boolean wal, String initSql, Object target);
    private static native int nExec(long db, int tx, String sql, ByteBuffer params, int flags, int chunkRows, Object target);
    private static native int nBatch(long db, int tx, ByteBuffer req, int flags, Object target);
    private static native int nTxBegin(long db, int mode, Object target);
    private static native int nTxEnd(long db, int tx, boolean commit, Object target);
    private static native int nLoadExtension(long db, String path, String entry, Object target);
    private static native int nClose(long db, Object target);
    public static native void release(long db);
    static native void freeNative(long ptr);

    /** Returns the db handle immediately; the callback reports the open result. Throws RuntimeException. */
    public static long open(long engine, String path, int flags, int busyMs, boolean wal, String initSql, Callback cb) {
        return nOpen(engine, path, flags, busyMs, wal, initSql, new Target(cb));
    }

    /** Returns 0 when queued, a negative core error otherwise (the callback is not called then). */
    public static int exec(long db, int tx, String sql, ByteBuffer params, int flags, int chunkRows, Callback cb) {
        return nExec(db, tx, sql, direct(params), flags, chunkRows, new Target(cb));
    }

    public static int batch(long db, int tx, ByteBuffer req, int flags, Callback cb) {
        return nBatch(db, tx, direct(req), flags, new Target(cb));
    }

    /** Returns the transaction id, 0 on error. */
    public static int txBegin(long db, int mode, Callback cb) {
        return nTxBegin(db, mode, new Target(cb));
    }

    public static int txEnd(long db, int tx, boolean commit, Callback cb) {
        return nTxEnd(db, tx, commit, new Target(cb));
    }

    public static int loadExtension(long db, String path, String entry, Callback cb) {
        return nLoadExtension(db, path, entry, new Target(cb));
    }

    public static int close(long db, Callback cb) {
        return nClose(db, new Target(cb));
    }
}
