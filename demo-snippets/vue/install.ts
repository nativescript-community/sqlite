import Vue from 'nativescript-vue';

import Basic from './Basic.vue';
import SQLiteBasic from './SQLiteBasic.vue';
import SQLiteBlobTooBig from './SQLiteBlobTooBig.vue';

export function installPlugin() {}

export const demos = [
    { name: 'Basic', path: 'basic', component: Basic },
    { name: 'SQLite Basic', path: 'sqlite-basic', component: SQLiteBasic },
    { name: 'SQLite Blob Too Big', path: 'sqlite-blob-too-big', component: SQLiteBlobTooBig }
];
