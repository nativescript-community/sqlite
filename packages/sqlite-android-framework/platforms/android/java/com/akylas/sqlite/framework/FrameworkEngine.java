package com.akylas.sqlite.framework;

import android.database.Cursor;
import android.database.DatabaseUtils;
import android.database.sqlite.SQLiteCursor;
import android.database.sqlite.SQLiteCursorDriver;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteProgram;
import android.database.sqlite.SQLiteQuery;
import android.database.sqlite.SQLiteStatement;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Runs statements on android.database.sqlite (the SQLite of the platform) for the native shim
 * libnssqlite_framework.so, which presents it to the nssqlite core as a sqlite3_* provider.
 *
 * Everything the shim needs crosses JNI as numbers and direct ByteBuffers, once per statement or per block of rows:
 * parameters come in the core wire format (params block), rows go out in the rows block format (NSR1, no string heap).
 * Called from the core's database threads, never from the JS thread.
 */
public final class FrameworkEngine {
    static {
        System.loadLibrary("nssqlite_framework");
    }

    /** Loads the native shim. Call before opening a database with the framework engine. */
    public static void init() {}

    // return codes of begin / more
    private static final long ERR_BASE = -(1L << 40); // ERR_BASE - code
    private static final long MORE_BIT = 1L << 31;

    private static final int OPEN_READONLY = 0x1;
    private static final int NO_LOCALIZED_COLLATORS = 0x10; // not in every SDK's public constants: no android_metadata table

    private static final int T_NULL = 0, T_INT32 = 1, T_INT64 = 2, T_DOUBLE = 3, T_TEXT = 4, T_BLOB = 5;
    private static final int HEADER = 32;

    private static final ConcurrentHashMap<Integer, SQLiteDatabase> conns = new ConcurrentHashMap<>();
    private static final ConcurrentHashMap<Integer, Stmt> stmts = new ConcurrentHashMap<>();
    private static int nextConn = 1;

    private static final ThreadLocal<String> lastMessage = new ThreadLocal<>();
    private static final Pattern CODE = Pattern.compile("\\(code (\\d+)");
    private static final Pattern WAL = Pattern.compile("^\\s*PRAGMA\\s+(main\\.)?journal_mode\\s*=\\s*'?wal'?\\s*;?\\s*$", Pattern.CASE_INSENSITIVE);
    private static String version;

    /** state of a statement that returned rows */
    private static final class Stmt {
        Cursor cursor;
        int ncols;
        byte[] names; // the column names part of a rows block
        byte[] pendingRow; // a row that did not fit the previous block
        boolean exhausted;
    }

    /** growable little endian writer for one row */
    private static final class Row {
        byte[] b = new byte[256];
        int n;

        void ensure(int extra) {
            if (n + extra > b.length) {
                int cap = b.length * 2;
                while (cap < n + extra) cap *= 2;
                byte[] nb = new byte[cap];
                System.arraycopy(b, 0, nb, 0, n);
                b = nb;
            }
        }

        void u8(int v) {
            ensure(1);
            b[n++] = (byte) v;
        }

        void u32(int v) {
            ensure(4);
            b[n++] = (byte) v;
            b[n++] = (byte) (v >> 8);
            b[n++] = (byte) (v >> 16);
            b[n++] = (byte) (v >> 24);
        }

        void i64(long v) {
            ensure(8);
            for (int i = 0; i < 8; i++) b[n++] = (byte) (v >> (8 * i));
        }

        void bytes(byte[] src) {
            ensure(src.length);
            System.arraycopy(src, 0, b, n, src.length);
            n += src.length;
        }
    }

    // ---------------------------------------------------------------------------------------------------------
    // called by the shim
    // ---------------------------------------------------------------------------------------------------------

    /** The SQLite version of the platform. */
    public static String version() {
        if (version == null) {
            SQLiteDatabase db = SQLiteDatabase.create(null);
            try {
                version = DatabaseUtils.stringForQuery(db, "select sqlite_version()", null);
            } finally {
                db.close();
            }
        }
        return version;
    }

    public static String lastMessage() {
        String m = lastMessage.get();
        return m == null ? "unknown error" : m;
    }

    /** @return a connection id (> 0), or ERR_BASE - code */
    public static long open(String path, int sqliteFlags) {
        try {
            int flags = NO_LOCALIZED_COLLATORS;
            if ((sqliteFlags & 0x1) != 0) {
                flags |= OPEN_READONLY;
            } else {
                flags |= SQLiteDatabase.OPEN_READWRITE | SQLiteDatabase.CREATE_IF_NECESSARY;
            }
            SQLiteDatabase db = SQLiteDatabase.openDatabase(path, null, flags);
            synchronized (conns) {
                int id = nextConn++;
                conns.put(id, db);
                return id;
            }
        } catch (Throwable e) {
            return fail(e);
        }
    }

    public static long close(int conn) {
        SQLiteDatabase db = conns.remove(conn);
        if (db == null) return 0;
        try {
            while (db.inTransaction()) db.endTransaction();
            db.close();
            return 0;
        } catch (Throwable e) {
            return fail(e);
        }
    }

    public static void release(int key) {
        Stmt s = stmts.remove(key);
        if (s != null && s.cursor != null) {
            try {
                s.cursor.close();
            } catch (Throwable e) {
                // nothing to report
            }
        }
    }

    /**
     * Executes a statement. Fills `out` with a rows block (up to maxRows rows, as many as fit).
     * @return bytes written | MORE_BIT when more rows can be fetched with more(), or ERR_BASE - code, or -needed
     *         when not even the first row fits `out`.
     */
    public static long begin(int conn, int key, ByteBuffer sqlBuf, int sqlLen, ByteBuffer params, int paramsLen, ByteBuffer out, int maxRows) {
        release(key);
        SQLiteDatabase db = conns.get(conn);
        if (db == null) return fail("database is closed", 21);
        try {
            sqlBuf.position(0).limit(sqlLen);
            String sql = StandardCharsets.UTF_8.decode(sqlBuf).toString();
            if (params != null) {
                params.order(ByteOrder.LITTLE_ENDIAN).position(0).limit(paramsLen);
            }
            ByteBuffer p = paramsLen > 0 ? params : null;
            String head = firstWord(sql);
            switch (head) {
                case "BEGIN": {
                    boolean exclusive = sql.toUpperCase(Locale.ROOT).contains("EXCLUSIVE");
                    if (exclusive) db.beginTransaction();
                    else db.beginTransactionNonExclusive();
                    return writeEmpty(out, 0, 0, true);
                }
                case "COMMIT":
                case "END":
                    db.setTransactionSuccessful();
                    db.endTransaction();
                    return writeEmpty(out, 0, 0, true);
                case "ROLLBACK":
                    if (!rollbackTo(sql)) {
                        db.endTransaction();
                        return writeEmpty(out, 0, 0, true);
                    }
                    break; // ROLLBACK TO savepoint: plain statement
                default:
            }
            if (isDml(head, sql)) {
                SQLiteStatement st = db.compileStatement(sql);
                try {
                    bind(st, p);
                    long changes = st.executeUpdateDelete();
                    long rowid = -1;
                    if (head.equals("INSERT") || head.equals("REPLACE")) {
                        rowid = DatabaseUtils.longForQuery(db, "select last_insert_rowid()", null);
                    }
                    return writeEmpty(out, changes, rowid, false);
                } finally {
                    st.close();
                }
            }
            if (WAL.matcher(sql).matches()) {
                db.enableWriteAheadLogging();
            }
            final ByteBuffer bound = p;
            SQLiteDatabase.CursorFactory factory = (d, driver, editTable, query) -> {
                bind(query, bound);
                return new SQLiteCursor(driver, editTable, query);
            };
            Cursor c = db.rawQueryWithFactory(factory, sql, null, null);
            Stmt s = new Stmt();
            s.cursor = c;
            s.ncols = c.getColumnCount();
            Row names = new Row();
            for (int i = 0; i < s.ncols; i++) {
                byte[] nb = c.getColumnName(i).getBytes(StandardCharsets.UTF_8);
                names.u32(nb.length);
                names.bytes(nb);
            }
            s.names = java.util.Arrays.copyOf(names.b, names.n);
            // the query runs now: errors surface here
            c.moveToPosition(-1);
            stmts.put(key, s);
            return fill(s, out, maxRows);
        } catch (Throwable e) {
            release(key);
            return fail(e);
        }
    }

    public static long more(int key, ByteBuffer out, int maxRows) {
        Stmt s = stmts.get(key);
        if (s == null) return fail("no statement", 21);
        try {
            return fill(s, out, maxRows);
        } catch (Throwable e) {
            release(key);
            return fail(e);
        }
    }

    // ---------------------------------------------------------------------------------------------------------

    private static long fail(Throwable e) {
        String m = String.valueOf(e.getMessage());
        int code = 1;
        Matcher mt = CODE.matcher(m);
        if (mt.find()) {
            try {
                code = Integer.parseInt(mt.group(1));
            } catch (NumberFormatException ignored) {
                code = 1;
            }
        } else if (e instanceof IllegalStateException) {
            code = 21;
        }
        lastMessage.set(e.getClass().getSimpleName().equals("SQLiteException") || e instanceof android.database.sqlite.SQLiteException ? m : e.getClass().getSimpleName() + ": " + m);
        return ERR_BASE - code;
    }

    private static long fail(String message, int code) {
        lastMessage.set(message);
        return ERR_BASE - code;
    }

    private static String firstWord(String sql) {
        int i = 0;
        int n = sql.length();
        while (i < n) {
            char c = sql.charAt(i);
            if (Character.isWhitespace(c)) {
                i++;
            } else if (c == '-' && i + 1 < n && sql.charAt(i + 1) == '-') {
                while (i < n && sql.charAt(i) != '\n') i++;
            } else if (c == '/' && i + 1 < n && sql.charAt(i + 1) == '*') {
                int e = sql.indexOf("*/", i + 2);
                i = e < 0 ? n : e + 2;
            } else {
                break;
            }
        }
        int s = i;
        while (i < n && Character.isLetter(sql.charAt(i))) i++;
        return sql.substring(s, i).toUpperCase(Locale.ROOT);
    }

    private static boolean rollbackTo(String sql) {
        String u = sql.toUpperCase(Locale.ROOT);
        int i = u.indexOf("ROLLBACK") + 8;
        while (i < u.length() && Character.isWhitespace(u.charAt(i))) i++;
        if (u.startsWith("TRANSACTION", i)) {
            i += 11;
            while (i < u.length() && Character.isWhitespace(u.charAt(i))) i++;
        }
        return u.startsWith("TO", i);
    }

    private static boolean isDml(String head, String sql) {
        switch (head) {
            case "INSERT":
            case "REPLACE":
            case "UPDATE":
            case "DELETE":
                return !sql.toUpperCase(Locale.ROOT).contains("RETURNING");
            default:
                return false;
        }
    }

    /** decodes a params block into the bindings of a statement */
    private static void bind(SQLiteProgram st, ByteBuffer p) {
        if (p == null) return;
        int count = p.getInt();
        for (int i = 1; i <= count; i++) {
            switch (p.get() & 0xff) {
                case T_NULL:
                    st.bindNull(i);
                    break;
                case T_INT32:
                    st.bindLong(i, p.getInt());
                    break;
                case T_INT64:
                    st.bindLong(i, p.getLong());
                    break;
                case T_DOUBLE:
                    st.bindDouble(i, p.getDouble());
                    break;
                case T_TEXT: {
                    int n = p.getInt();
                    byte[] b = new byte[n];
                    p.get(b);
                    st.bindString(i, new String(b, StandardCharsets.UTF_8));
                    break;
                }
                case T_BLOB: {
                    int n = p.getInt();
                    byte[] b = new byte[n];
                    p.get(b);
                    st.bindBlob(i, b);
                    break;
                }
                default:
                    throw new IllegalArgumentException("malformed parameters");
            }
        }
    }

    private static void header(ByteBuffer out, int ncols, long changes, long rowid) {
        out.order(ByteOrder.LITTLE_ENDIAN);
        out.position(0);
        out.putInt(0x3152534e); // NSR1
        out.putInt(ncols);
        out.putInt(0); // nrows, patched
        out.putLong(changes);
        out.putLong(rowid);
        out.putInt(0); // heap offset, patched
    }

    /** a block without rows: statements that return none. changes < 0: unchanged (as for a transaction statement) */
    private static long writeEmpty(ByteBuffer out, long changes, long rowid, boolean keepCounts) {
        header(out, 0, keepCounts ? -1 : changes, keepCounts ? -1 : rowid);
        out.putInt(28, HEADER);
        return HEADER;
    }

    private static long fill(Stmt s, ByteBuffer out, int maxRows) {
        out.order(ByteOrder.LITTLE_ENDIAN);
        int capacity = out.capacity();
        header(out, s.ncols, -1, -1);
        out.put(s.names);
        int nrows = 0;
        Row row = new Row();
        boolean more = true;
        while (nrows < maxRows) {
            byte[] bytes;
            int len;
            if (s.pendingRow != null) {
                bytes = s.pendingRow;
                len = bytes.length;
            } else {
                if (s.exhausted || !s.cursor.moveToNext()) {
                    s.exhausted = true;
                    more = false;
                    break;
                }
                row.n = 0;
                for (int c = 0; c < s.ncols; c++) writeValue(row, s.cursor, c);
                bytes = row.b;
                len = row.n;
            }
            if (out.position() + len > capacity) {
                if (nrows == 0) {
                    s.pendingRow = java.util.Arrays.copyOf(bytes, len);
                    return -(out.position() + len);
                }
                s.pendingRow = java.util.Arrays.copyOf(bytes, len);
                break;
            }
            out.put(bytes, 0, len);
            s.pendingRow = null;
            nrows++;
        }
        int end = out.position();
        out.putInt(8, nrows);
        out.putInt(28, end);
        if (!more && s.pendingRow == null) {
            // all rows delivered: free the cursor early
            try {
                s.cursor.close();
            } catch (Throwable ignored) {
                // nothing to report
            }
            return end;
        }
        return end | MORE_BIT;
    }

    private static void writeValue(Row r, Cursor c, int i) {
        switch (c.getType(i)) {
            case Cursor.FIELD_TYPE_NULL:
                r.u8(T_NULL);
                break;
            case Cursor.FIELD_TYPE_INTEGER: {
                long v = c.getLong(i);
                if (v >= Integer.MIN_VALUE && v <= Integer.MAX_VALUE) {
                    r.u8(T_INT32);
                    r.u32((int) v);
                } else {
                    r.u8(T_INT64);
                    r.i64(v);
                }
                break;
            }
            case Cursor.FIELD_TYPE_FLOAT:
                r.u8(T_DOUBLE);
                r.i64(Double.doubleToRawLongBits(c.getDouble(i)));
                break;
            case Cursor.FIELD_TYPE_STRING: {
                byte[] b = c.getString(i).getBytes(StandardCharsets.UTF_8);
                r.u8(T_TEXT);
                r.u32(b.length);
                r.bytes(b);
                break;
            }
            default: {
                byte[] b = c.getBlob(i);
                r.u8(T_BLOB);
                r.u32(b.length);
                r.bytes(b);
            }
        }
    }
}
