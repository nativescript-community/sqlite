<template>
    <Page>
        <ActionBar>
            <Label text="SQLite Blob Too Big Demo" />
        </ActionBar>

        <ScrollView>
            <StackLayout padding="16">
                <Label text="SQLiteBlobTooBigException" class="title" />
                <Label class="description" textWrap="true"
                    text="On Android, the SQLite cursor window is limited to ~2 MB. Reading a BLOB larger than this limit throws android.database.sqlite.SQLiteBlobTooBigException. This demo stores a 3 MB blob and then attempts to read it back through the cursor to trigger and catch that exception." />

                <Button text="Run Demo" @tap="onRunDemo" />

                <Label text="Log:" class="section-title" />
                <ListView :items="logLines" height="400">
                    <v-template>
                        <Label :text="item" class="log-row" textWrap="true" />
                    </v-template>
                </ListView>
            </StackLayout>
        </ScrollView>
    </Page>
</template>

<script lang="ts">
import Vue from 'nativescript-vue';
import { knownFolders, path, isAndroid } from '@nativescript/core';
import { openOrCreate, deleteDatabase } from '@nativescript-community/sqlite';

const DB_PATH = path.join(knownFolders.documents().path, 'blob_demo.sqlite');

// Build a zero-filled Uint8Array of the given byte length.
// Using zeros keeps memory usage predictable for this demo.
function makeLargeBuffer(byteLength: number): Uint8Array {
    return new Uint8Array(byteLength);
}

export default Vue.extend({
    data() {
        return {
            logLines: [] as string[]
        };
    },

    methods: {
        log(msg: string) {
            this.logLines = [...this.logLines, msg];
        },

        async onRunDemo() {
            this.logLines = [];
            let db = null;

            try {
                // ── 1. Open / create the database ────────────────────────────
                db = openOrCreate(DB_PATH);
                this.log('✔ DB opened');

                // ── 2. Create table for binary data ──────────────────────────
                await db.execute(
                    'CREATE TABLE IF NOT EXISTS blobs (id INTEGER PRIMARY KEY, data BLOB)'
                );
                await db.execute('DELETE FROM blobs'); // start clean
                this.log('✔ Table ready');

                // ── 3. Insert a 3 MB blob ─────────────────────────────────────
                // Android cursor window default size is ~2 MB, so reading this
                // back via rawQuery will throw SQLiteBlobTooBigException.
                const THREE_MB = 3 * 1024 * 1024;
                const largeBuffer = makeLargeBuffer(THREE_MB);

                await db.execute('INSERT INTO blobs (id, data) VALUES (?, ?)', [
                    1,
                    largeBuffer
                ]);
                this.log(`✔ Inserted ${THREE_MB / 1024 / 1024} MB blob (id=1)`);

                // ── 4. Attempt to read the oversized blob back ────────────────
                // On Android this goes through db.rawQuery() → cursor.getBlob()
                // which will throw SQLiteBlobTooBigException for blobs that
                // exceed the cursor window size.
                this.log('⏳ Attempting to SELECT the large blob…');

                try {
                    const rows = await db.select('SELECT * FROM blobs WHERE id = ?', [1]);
                    // If we reach here the platform did NOT throw (e.g. iOS).
                    this.log(`ℹ Platform did not throw — got ${rows.length} row(s)`);
                    this.log('  (SQLiteBlobTooBigException is Android-specific)');
                } catch (readError) {
                    // ── 5. Handle SQLiteBlobTooBigException ───────────────────
                    const isTooBig =
                        isAndroid &&
                        readError &&
                        readError.toString().includes('SQLiteBlobTooBigException');

                    if (isTooBig) {
                        this.log('✔ Caught SQLiteBlobTooBigException (expected on Android)');
                        this.log(`  Message: ${readError.message || readError}`);
                        this.log('');
                        this.log('💡 Workaround options:');
                        this.log('  • Retrieve only the length: SELECT length(data) FROM blobs');
                        this.log('  • Use OFFSET/LIMIT with zeroblob + writefile');
                        this.log('  • Increase CursorWindow size (API ≥ 28 only)');
                        this.log('  • Store large assets as files; keep only paths in DB');
                    } else {
                        this.log(`✘ Unexpected error: ${readError}`);
                    }
                }

                // ── 6. Demonstrate safe partial read ─────────────────────────
                this.log('');
                this.log('✔ Safe read — retrieving only the blob length:');
                const lenRow = await db.get(
                    'SELECT id, length(data) AS byte_count FROM blobs WHERE id = ?',
                    [1]
                );
                if (lenRow) {
                    this.log(`  id=${lenRow['id']}  byte_count=${lenRow['byte_count']}`);
                }
            } catch (e) {
                this.log(`✘ Fatal error: ${e.message || e}`);
            } finally {
                // ── 7. Clean up ───────────────────────────────────────────────
                if (db) {
                    db.close();
                }
                deleteDatabase(DB_PATH);
                this.log('');
                this.log('✔ DB closed and deleted');
            }
        }
    }
});
</script>

<style scoped lang="scss">
ActionBar {
    background-color: #c0392b;
    color: white;
}
Button {
    background-color: #c0392b;
    color: white;
    margin: 8;
}
.title {
    font-size: 18;
    font-weight: bold;
    margin-bottom: 6;
}
.description {
    font-size: 13;
    color: #555;
    margin-bottom: 12;
}
.section-title {
    font-size: 15;
    font-weight: bold;
    margin-top: 10;
    margin-bottom: 4;
}
.log-row {
    font-size: 12;
    padding: 3;
    border-bottom-width: 0.5;
    border-color: #eee;
    font-family: monospace;
}
</style>
