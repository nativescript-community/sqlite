/* TypeORM through the plugin's NativescriptDriver on a device. */
import 'reflect-metadata';
import { DataSource, EntitySchema } from 'typeorm/browser';
import { installMixins } from '@nativescript-community/sqlite/typeorm';
import { deleteDatabase } from '@nativescript-community/sqlite';
import { messageOf, stackOf } from './util';
import * as sqliteModule from '@nativescript-community/sqlite';

const log = (...args: any[]) => console.log('[ORM]', ...args);

interface User { id?: number; name: string; age: number; active: boolean; meta?: any; avatar?: Uint8Array | null; createdAt?: Date; posts?: Post[] }
interface Post { id?: number; title: string; author?: User; tags?: Tag[] }
interface Tag { id?: number; label: string }

const UserSchema = new EntitySchema<User>({
    name: 'User',
    columns: {
        id: { type: 'integer', primary: true, generated: 'increment' },
        name: { type: 'varchar', length: 100 },
        age: { type: 'int' },
        active: { type: 'boolean', default: true },
        createdAt: { type: 'datetime', createDate: true },
        meta: { type: 'simple-json', nullable: true },
        avatar: { type: 'blob', nullable: true }
    },
    uniques: [{ name: 'UQ_user_name', columns: ['name'] }],
    relations: { posts: { type: 'one-to-many', target: 'Post', inverseSide: 'author' } }
});
const PostSchema = new EntitySchema<Post>({
    name: 'Post',
    columns: { id: { type: 'integer', primary: true, generated: 'increment' }, title: { type: 'varchar' } },
    relations: {
        author: { type: 'many-to-one', target: 'User', onDelete: 'CASCADE', nullable: true, inverseSide: 'posts' },
        tags: { type: 'many-to-many', target: 'Tag', joinTable: true, cascade: true }
    }
});
const TagSchema = new EntitySchema<Tag>({ name: 'Tag', columns: { id: { type: 'integer', primary: true, generated: 'increment' }, label: { type: 'varchar' } } });

let passed = 0;
let failed = 0;
async function check(name: string, fn: () => Promise<void>) {
    try {
        await fn();
        passed++;
    } catch (error) {
        failed++;
        log('FAIL', name, messageOf(error));
    }
}
function eq(actual: any, expected: any, what = '') {
    const actualJson = JSON.stringify(actual);
    const expectedJson = JSON.stringify(expected);
    if (actualJson !== expectedJson) throw new Error(`${what} expected ${expectedJson} got ${actualJson}`);
}

export async function runOrmTests() {
    try {
        installMixins();
        deleteDatabase('orm-test.db');
        const ds = new DataSource({ type: 'nativescript', database: 'orm-test.db', driver: sqliteModule, entities: [UserSchema, PostSchema, TagSchema], synchronize: true });
        await ds.initialize();
        const users = ds.getRepository<User>('User');
        const posts = ds.getRepository<Post>('Post');

        await check('schema', async () => {
            const tables = (await ds.query("SELECT name FROM sqlite_master WHERE type = 'table'")).map((row: any) => row.name);
            eq(['user', 'post', 'tag', 'post_tags_tag'].every((tableName) => tables.includes(tableName)), true, tables.join());
        });
        await check('typed values', async () => {
            const saved = await users.save({ name: 'ann', age: 30, active: false, meta: { a: [1, 2] }, avatar: new Uint8Array([1, 2, 250]) });
            eq(saved.id, 1);
            const ann = await users.findOneBy({ id: 1 });
            eq([ann.active, ann.meta, Array.from(ann.avatar), ann.createdAt instanceof Date], [false, { a: [1, 2] }, [1, 2, 250], true]);
        });
        await check('find / count / update / delete', async () => {
            await users.save(Array.from({ length: 20 }, (_, index) => ({ name: 'u' + index, age: index, active: index % 2 === 0 })));
            eq(await users.count(), 21);
            eq((await users.update({ active: true }, { age: 99 })).affected, 10);
            eq((await users.delete({ name: 'u1' })).affected, 1);
            eq((await users.find({ where: { age: 99 }, order: { name: 'ASC' }, take: 2 })).map((user) => user.name), ['u0', 'u10']);
        });
        await check('relations', async () => {
            const ann = await users.findOneBy({ name: 'ann' });
            await posts.save({ title: 'p1', author: ann, tags: [{ label: 't1' }, { label: 't2' }] });
            const loaded = await users.findOne({ where: { id: ann.id }, relations: ['posts', 'posts.tags'] });
            eq([loaded.posts[0].title, loaded.posts[0].tags.map((tag) => tag.label).sort()], ['p1', ['t1', 't2']]);
            await users.delete({ id: ann.id });
            eq(await posts.count(), 0); // foreign key cascade
        });
        await check('constraint error', async () => {
            await users.save({ name: 'dup', age: 1, active: true });
            let err: any;
            try {
                await users.save({ name: 'dup', age: 2, active: true });
            } catch (error) {
                err = error;
            }
            eq(/UNIQUE constraint failed/.test(String(err && err.message)), true, String(err));
        });
        await check('query builder', async () => {
            const raw = await users.createQueryBuilder('u').select('u.active', 'active').addSelect('COUNT(*)', 'n').groupBy('u.active').orderBy('u.active').getRawMany();
            eq(raw.length, 2);
        });
        await check('transactions', async () => {
            const before = await users.count();
            await ds.transaction(async (em) => {
                await em.save('User', { name: 'tx-ok', age: 1, active: true });
            });
            let threw = false;
            try {
                await ds.transaction(async (em) => {
                    await em.save('User', { name: 'tx-bad', age: 1, active: true });
                    throw new Error('abort');
                });
            } catch (error) {
                threw = true;
            }
            eq([threw, await users.count()], [true, before + 1]);
        });
        await check('concurrent saves', async () => {
            const before = await users.count();
            await Promise.all(Array.from({ length: 100 }, (_, index) => users.save({ name: 'c' + index, age: index, active: true })));
            eq(await users.count(), before + 100);
        });
        await ds.destroy();
        deleteDatabase('orm-test.db');
        log('RESULT passed', passed, 'failed', failed);
    } catch (error) {
        log('ERROR', messageOf(error), stackOf(error, 4));
    }
}
