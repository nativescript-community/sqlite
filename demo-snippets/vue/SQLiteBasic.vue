<template>
    <Page>
        <ActionBar>
            <Label text="SQLite Basic Demo" />
        </ActionBar>

        <ScrollView>
            <StackLayout padding="16">
                <Label text="SQLite Demo" class="title" />
                <Label :text="statusMessage" class="status" textWrap="true" />

                <Button text="Create DB &amp; Table" @tap="onCreateDb" />
                <Button text="Insert Records" @tap="onInsert" />
                <Button text="Search (SELECT)" @tap="onSearch" />
                <Button text="Delete a Record" @tap="onDelete" />
                <Button text="Close &amp; Delete DB" @tap="onCleanup" />

                <Label text="Results:" class="section-title" />
                <ListView :items="results" height="300">
                    <v-template>
                        <Label :text="item" class="result-row" textWrap="true" />
                    </v-template>
                </ListView>
            </StackLayout>
        </ScrollView>
    </Page>
</template>

<script lang="ts">
import Vue from 'nativescript-vue';
import { knownFolders, path } from '@nativescript/core';
import { openOrCreate, deleteDatabase } from '@nativescript-community/sqlite';

const DB_PATH = path.join(knownFolders.documents().path, 'demo.sqlite');

export default Vue.extend({
    data() {
        return {
            db: null as any,
            statusMessage: 'Tap a button to begin.',
            results: [] as string[]
        };
    },

    methods: {
        log(msg: string) {
            this.results = [msg, ...this.results];
        },

        async onCreateDb() {
            try {
                this.db = openOrCreate(DB_PATH);
                await this.db.execute(`
                    CREATE TABLE IF NOT EXISTS people (
                        id   INTEGER PRIMARY KEY AUTOINCREMENT,
                        name TEXT    NOT NULL,
                        age  INTEGER NOT NULL
                    )
                `);
                await this.db.setVersion(1);
                this.statusMessage = `DB opened (version ${this.db.getVersion()})`;
                this.log('✔ DB created / opened');
                this.log('✔ Table "people" ready');
            } catch (e) {
                this.statusMessage = `Error: ${e.message}`;
                this.log(`✘ ${e.message}`);
            }
        },

        async onInsert() {
            if (!this.db) {
                this.statusMessage = 'Create the DB first.';
                return;
            }
            try {
                const records = [
                    ['Alice', 30],
                    ['Bob', 25],
                    ['Carol', 35],
                    ['Dave', 28]
                ];

                await this.db.transaction(async () => {
                    for (const [name, age] of records) {
                        await this.db.execute(
                            'INSERT INTO people (name, age) VALUES (?, ?)',
                            [name, age]
                        );
                    }
                });

                this.statusMessage = `Inserted ${records.length} records`;
                this.log(`✔ Inserted: ${records.map(r => r[0]).join(', ')}`);
            } catch (e) {
                this.statusMessage = `Error: ${e.message}`;
                this.log(`✘ ${e.message}`);
            }
        },

        async onSearch() {
            if (!this.db) {
                this.statusMessage = 'Create the DB first.';
                return;
            }
            try {
                // Select all rows
                const all = await this.db.select('SELECT * FROM people ORDER BY age ASC');
                this.log(`✔ All rows (${all.length}):`);
                for (const row of all) {
                    this.log(`   id=${row.id}  name=${row.name}  age=${row.age}`);
                }

                // Parameterised search – age >= 29
                const older = await this.db.select(
                    'SELECT name, age FROM people WHERE age >= ?',
                    [29]
                );
                this.log(`✔ age >= 29 (${older.length} rows):`);
                for (const row of older) {
                    this.log(`   ${row.name} (${row.age})`);
                }

                this.statusMessage = `Found ${all.length} total, ${older.length} aged ≥ 29`;
            } catch (e) {
                this.statusMessage = `Error: ${e.message}`;
                this.log(`✘ ${e.message}`);
            }
        },

        async onDelete() {
            if (!this.db) {
                this.statusMessage = 'Create the DB first.';
                return;
            }
            try {
                // Delete rows with age < 30
                await this.db.execute('DELETE FROM people WHERE age < ?', [30]);
                const remaining = await this.db.select('SELECT * FROM people');
                this.statusMessage = `Deleted age < 30; ${remaining.length} rows remain`;
                this.log(`✔ Deleted records where age < 30`);
                this.log(`✔ Remaining: ${remaining.map(r => r['name']).join(', ') || '(none)'}`);
            } catch (e) {
                this.statusMessage = `Error: ${e.message}`;
                this.log(`✘ ${e.message}`);
            }
        },

        async onCleanup() {
            try {
                if (this.db) {
                    this.db.close();
                    this.db = null;
                }
                const deleted = deleteDatabase(DB_PATH);
                this.statusMessage = `DB closed & deleted: ${deleted}`;
                this.results = [];
                this.log(`✔ DB closed and deleted`);
            } catch (e) {
                this.statusMessage = `Error: ${e.message}`;
                this.log(`✘ ${e.message}`);
            }
        }
    }
});
</script>

<style scoped lang="scss">
ActionBar {
    background-color: #42b883;
    color: white;
}
Button {
    background-color: #42b883;
    color: white;
    margin: 4;
}
.title {
    font-size: 20;
    font-weight: bold;
    margin-bottom: 8;
}
.section-title {
    font-size: 16;
    font-weight: bold;
    margin-top: 12;
    margin-bottom: 4;
}
.status {
    color: #555;
    margin-bottom: 8;
}
.result-row {
    font-size: 13;
    padding: 4;
    border-bottom-width: 0.5;
    border-color: #ddd;
}
</style>
