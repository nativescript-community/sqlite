import { strict as assert } from 'assert';
import { after, before, describe, it } from 'node:test';
import { DataSource, EntitySchema, QueryFailedError } from 'typeorm/browser';
import { NativescriptDriver, installMixins } from '../typeorm';
import { SqliteError } from '../sqlite.common';
import { open, tmpDb } from './support';

installMixins();

interface User {
    id?: number;
    name: string;
    age: number;
    active: boolean;
    score?: number;
    bio?: string | null;
    createdAt?: Date;
    meta?: any;
    avatar?: Uint8Array | null;
    role?: string;
    posts?: Post[];
}
interface Post {
    id?: number;
    title: string;
    author?: User;
    tags?: Tag[];
}
interface Tag {
    id?: number;
    label: string;
}

const UserSchema = new EntitySchema<User>({
    name: 'User',
    columns: {
        id: { type: 'integer', primary: true, generated: 'increment' },
        name: { type: 'varchar', length: 100 },
        age: { type: 'int' },
        active: { type: 'boolean', default: true },
        score: { type: 'float', nullable: true },
        bio: { type: 'text', nullable: true },
        createdAt: { type: 'datetime', createDate: true },
        meta: { type: 'simple-json', nullable: true },
        avatar: { type: 'blob', nullable: true },
        role: { type: 'simple-enum', enum: ['admin', 'user'], default: 'user' }
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
const TagSchema = new EntitySchema<Tag>({
    name: 'Tag',
    columns: { id: { type: 'integer', primary: true, generated: 'increment' }, label: { type: 'varchar' } }
});

/** the driver loads "@nativescript-community/sqlite" by default: hand it the Node test module instead */
const driverModule = { openOrCreate: (file: string, extra: any) => open(file, extra) };

function dataSource(file = ':memory:', extra: any = {}) {
    return new DataSource({
        type: 'nativescript',
        database: file,
        driver: driverModule,
        entities: [UserSchema, PostSchema, TagSchema],
        synchronize: true,
        extra
    } as any);
}

async function withDs<T>(fn: (ds: DataSource) => Promise<T>, file?: string) {
    const ds = dataSource(file);
    await ds.initialize();
    try {
        return await fn(ds);
    } finally {
        await ds.destroy();
    }
}

describe('typeorm: schema', () => {
    it('creates tables, indexes and foreign keys from the entities', () =>
        withDs(async (ds) => {
            const tables = (await ds.query("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")).map((row: any) => row.name);
            assert.ok(tables.includes('user') && tables.includes('post') && tables.includes('tag') && tables.includes('post_tags_tag'), tables.join());
            const fks = await ds.query('PRAGMA foreign_keys');
            assert.equal(fks[0].foreign_keys, 1);
            assert.ok(ds.driver instanceof NativescriptDriver);
        }));

    it('synchronizing again is a no-op and can add a column', async () => {
        const file = tmpDb();
        await withDs(async (ds) => {
            await ds.getRepository('User').save({ name: 'keep', age: 1, active: true });
        }, file);
        const v2 = new EntitySchema<User>({
            name: 'User',
            tableName: 'user',
            columns: { ...UserSchema.options.columns, nickname: { type: 'varchar', nullable: true } },
            uniques: UserSchema.options.uniques
        });
        const ds = new DataSource({ type: 'nativescript', database: file, driver: driverModule, entities: [v2, PostSchema, TagSchema], synchronize: true });
        await ds.initialize();
        try {
            const cols = (await ds.query('PRAGMA table_info(user)')).map((column: any) => column.name);
            assert.ok(cols.includes('nickname'));
            assert.equal((await ds.getRepository('User').find()).length, 1); // data survived the table rebuild
        } finally {
            await ds.destroy();
        }
    });

    it('drops the database', () =>
        withDs(async (ds) => {
            await ds.dropDatabase();
            const tables = await ds.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'");
            assert.equal(tables.length, 0);
        }));
});

describe('typeorm: repositories', () => {
    it('inserts with generated ids and defaults, reads typed values back', () =>
        withDs(async (ds) => {
            const repo = ds.getRepository<User>('User');
            const avatar = new Uint8Array([1, 2, 3, 250]);
            const saved = await repo.save({ name: 'ann', age: 30, active: false, score: 1.5, bio: 'héllo €', meta: { a: [1, 2], b: 'x' }, avatar, role: 'admin' });
            assert.equal(saved.id, 1);
            assert.ok(saved.createdAt instanceof Date);
            const second = await repo.save({ name: 'bob', age: 41, active: true });
            assert.equal(second.id, 2);
            const ann = await repo.findOneBy({ id: 1 });
            assert.equal(ann.name, 'ann');
            assert.equal(ann.active, false);
            assert.equal(ann.score, 1.5);
            assert.equal(ann.bio, 'héllo €');
            assert.deepEqual(ann.meta, { a: [1, 2], b: 'x' });
            assert.deepEqual(Array.from(ann.avatar), [1, 2, 3, 250]);
            assert.equal(ann.role, 'admin');
            assert.ok(ann.createdAt instanceof Date && Math.abs(ann.createdAt.getTime() - Date.now()) < 60_000);
            const bob = await repo.findOneBy({ id: 2 });
            assert.equal(bob.role, 'user'); // default
            assert.equal(bob.active, true);
            assert.equal(bob.avatar, null);
        }));

    it('finds with where, order, pagination and counts', () =>
        withDs(async (ds) => {
            const repo = ds.getRepository<User>('User');
            await repo.save(Array.from({ length: 50 }, (_, index) => ({ name: 'u' + String(index).padStart(2, '0'), age: index % 10, active: index % 2 === 0 })));
            assert.equal(await repo.count(), 50);
            assert.equal(await repo.countBy({ active: true }), 25);
            const page = await repo.find({ where: { age: 3 }, order: { name: 'DESC' }, take: 3, skip: 1 });
            assert.deepEqual(page.map((user) => user.name), ['u33', 'u23', 'u13']);
            const [rows, total] = await repo.findAndCount({ where: { active: false }, take: 5 });
            assert.equal(rows.length, 5);
            assert.equal(total, 25);
            assert.equal(await repo.findOneBy({ name: 'nope' }), null);
        }));

    it('updates and deletes, with affected counts', () =>
        withDs(async (ds) => {
            const repo = ds.getRepository<User>('User');
            await repo.save([{ name: 'a', age: 1, active: true }, { name: 'b', age: 2, active: true }, { name: 'c', age: 3, active: true }]);
            const upd = await repo.update({ active: true }, { age: 99 });
            assert.equal(upd.affected, 3);
            assert.equal((await repo.findBy({ age: 99 })).length, 3);
            const del = await repo.delete({ name: 'b' });
            assert.equal(del.affected, 1);
            assert.equal(await repo.count(), 2);
            const one = await repo.findOneBy({ name: 'a' });
            one.age = 5;
            await repo.save(one);
            assert.equal((await repo.findOneBy({ name: 'a' })).age, 5);
            await repo.remove(one);
            assert.equal(await repo.count(), 1);
        }));

    it('reports constraint violations as QueryFailedError with the SQLite error', () =>
        withDs(async (ds) => {
            const repo = ds.getRepository<User>('User');
            await repo.save({ name: 'dup', age: 1, active: true });
            await assert.rejects(repo.save({ name: 'dup', age: 2, active: true }), (error: any) => {
                assert.ok(error instanceof QueryFailedError);
                assert.match(error.message, /UNIQUE constraint failed/);
                return true;
            });
            assert.equal(await repo.count(), 1);
        }));
});

describe('typeorm: relations', () => {
    it('saves and loads many-to-one, one-to-many and many-to-many', () =>
        withDs(async (ds) => {
            const users = ds.getRepository<User>('User');
            const posts = ds.getRepository<Post>('Post');
            const ann = await users.save({ name: 'ann', age: 30, active: true });
            await posts.save({ title: 'p1', author: ann, tags: [{ label: 't1' }, { label: 't2' }] });
            await posts.save({ title: 'p2', author: ann, tags: [] });
            const loaded = await users.findOne({ where: { id: ann.id }, relations: { posts: { tags: true } }, order: { posts: { id: 'ASC' } } });
            assert.deepEqual(loaded.posts.map((entry) => entry.title), ['p1', 'p2']);
            assert.deepEqual(loaded.posts[0].tags.map((tag) => tag.label).sort(), ['t1', 't2']);
            const post = await posts.findOne({ where: { title: 'p1' }, relations: { author: true } });
            assert.equal(post.author.name, 'ann');
        }));

    it('cascades deletes through foreign keys', () =>
        withDs(async (ds) => {
            const users = ds.getRepository<User>('User');
            const posts = ds.getRepository<Post>('Post');
            const ann = await users.save({ name: 'ann', age: 30, active: true });
            await posts.save({ title: 'p1', author: ann });
            await users.delete({ id: ann.id });
            assert.equal(await posts.count(), 0);
            // foreign keys are enforced
            await assert.rejects(ds.query('INSERT INTO post (title, authorId) VALUES (?, ?)', ['bad', 999]), /FOREIGN KEY/);
        }));
});

describe('typeorm: query builder and raw queries', () => {
    it('selects, aggregates and filters with named parameters', () =>
        withDs(async (ds) => {
            const repo = ds.getRepository<User>('User');
            await repo.save(Array.from({ length: 20 }, (_, index) => ({ name: 'q' + index, age: index, active: index % 2 === 0 })));
            const rows = await repo.createQueryBuilder('u').where('u.age >= :min AND u.age < :max', { min: 5, max: 8 }).orderBy('u.age', 'ASC').getMany();
            assert.deepEqual(rows.map((row) => row.age), [5, 6, 7]);
            const raw = await repo.createQueryBuilder('u').select('u.active', 'active').addSelect('COUNT(*)', 'n').addSelect('SUM(u.age)', 'sum').groupBy('u.active').orderBy('u.active').getRawMany();
            assert.deepEqual(raw.map((row) => [row.active, row.n, row.sum]), [[0, 10, 100], [1, 10, 90]]);
            const upd = await repo.createQueryBuilder().update().set({ age: 0 }).where('age < :a', { a: 3 }).execute();
            assert.equal(upd.affected, 3);
            const del = await repo.createQueryBuilder().delete().where('age = 0').execute();
            assert.equal(del.affected, 3);
            const ins = await repo.createQueryBuilder().insert().values([{ name: 'x1', age: 1, active: true }, { name: 'x2', age: 2, active: true }]).execute();
            assert.equal(ins.identifiers.length, 2);
        }));

    it('runs raw queries with parameters and returns rows as objects', () =>
        withDs(async (ds) => {
            const rows = await ds.query('SELECT ? AS a, ? AS b', [1, 'two']);
            assert.deepEqual(rows, [{ a: 1, b: 'two' }]);
            await ds.query('CREATE TABLE extra(a INTEGER PRIMARY KEY, b)');
            await ds.query('INSERT INTO extra(b) VALUES (?)', ['x']);
            assert.deepEqual(await ds.query('SELECT * FROM extra'), [{ a: 1, b: 'x' }]);
        }));
});

describe('typeorm: transactions', () => {
    it('commits and rolls back', () =>
        withDs(async (ds) => {
            await ds.transaction(async (em) => {
                await em.save('User', { name: 'in-tx', age: 1, active: true });
            });
            assert.equal(await ds.getRepository('User').count(), 1);
            await assert.rejects(
                ds.transaction(async (em) => {
                    await em.save('User', { name: 'rolled-back', age: 1, active: true });
                    throw new Error('abort');
                }),
                /abort/
            );
            assert.equal(await ds.getRepository('User').count(), 1);
        }));

    it('supports a manual query runner transaction', () =>
        withDs(async (ds) => {
            const qr = ds.createQueryRunner();
            await qr.connect();
            await qr.startTransaction();
            await qr.manager.save('User', { name: 'manual', age: 1, active: true });
            await qr.rollbackTransaction();
            await qr.release();
            assert.equal(await ds.getRepository('User').count(), 0);
        }));
});

describe('typeorm: lifecycle and load', () => {
    it('uses a file database, survives re-initialization', async () => {
        const file = tmpDb();
        await withDs(async (ds) => {
            await ds.getRepository('User').save({ name: 'persisted', age: 1, active: true });
        }, file);
        await withDs(async (ds) => {
            assert.equal((await ds.getRepository<User>('User').findOneBy({ name: 'persisted' })).age, 1);
        }, file);
    });

    it('destroys the data source', async () => {
        const ds = dataSource();
        await ds.initialize();
        assert.equal(ds.isInitialized, true);
        await ds.destroy();
        assert.equal(ds.isInitialized, false);
    });

    it('handles many concurrent saves and a big read', () =>
        withDs(async (ds) => {
            const repo = ds.getRepository<User>('User');
            await Promise.all(Array.from({ length: 200 }, (_, index) => repo.save({ name: 'c' + index, age: index, active: true })));
            assert.equal(await repo.count(), 200);
            await repo.save(Array.from({ length: 5000 }, (_, index) => ({ name: 'b' + index, age: index, active: false })), { chunk: 500 });
            assert.equal((await repo.find()).length, 5200);
        }));

    it('passes engine options through "extra"', async () => {
        const ds = dataSource(':memory:', { initSql: 'PRAGMA user_version = 9' });
        await ds.initialize();
        assert.equal((await ds.query('PRAGMA user_version'))[0].user_version, 9);
        await ds.destroy();
    });
});

after(() => {});
before(() => {});
