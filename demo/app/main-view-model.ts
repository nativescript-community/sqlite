import { Observable } from '@nativescript/core/data/observable';
import { SQLiteDatabase, deleteDatabase, openOrCreate } from '@nativescript-community/sqlite';
import { knownFolders, path } from '@nativescript/core/file-system';
import { ImageSource } from '@nativescript/core';
import { BaseEntity, Column, Connection, Entity, PrimaryGeneratedColumn, createConnection } from 'typeorm/browser';
import { installMixins } from '@nativescript-community/sqlite/typeorm';

interface DataExample {
    id: number;
    name: string;
}

@Entity()
export default class ImageTest extends BaseEntity {
    @PrimaryGeneratedColumn()
    id: number;
    @Column('blob', { nullable: false })
    data: any;

    @Column('int', { nullable: false })
    width: number;

    @Column('int', { nullable: false })
    height: number;
}

export class HelloWorldModel extends Observable {
    public message: string = '';
    public imageSource: ImageSource = null;
    sqlite: SQLiteDatabase;

    constructor() {
        super();
        this.resetDb().then(() => {
            this.sqlite.setVersion(1).then(() => {
                this.sqlite.getVersion().then((r) => {
                    console.log('got version', r);
                    this.message = `version = ${r}`;
                });
            });
        });
    }

    resetDb() {
        const filePath = path.join(knownFolders.documents().getFolder('db').path, 'dbname.sqlite');
        deleteDatabase(filePath);
        this.sqlite = openOrCreate(filePath);
        const createCmd = 'CREATE TABLE names (id INT, name TEXT, json TEXT, PRIMARY KEY (id))';
        return this.sqlite.execute(createCmd);
    }

    async insert(data: DataExample[]) {
        for (let index = 0; index < data.length; index++) {
            const d = data[index];
            const insert = 'INSERT INTO names (id, name, json) VALUES (?, ?, ?)';
            // Uncomment to crash it
            if (index === 1000) {
                console.log('About to crash!');
                d.id = 0;
            }
            await this.sqlite.execute(insert, [d.id, d.name, JSON.stringify(data)]);
        }
    }

    onInsert() {
        try {
            this.insert(generateData(10000));
        } catch (error) {
            alert('Error onInsert: ' + error);
        }
    }

    onInsertWithTrans() {
        try {
            this.sqlite.transaction(() => this.insert(generateData(10000)));
        } catch (error) {
            alert('Error onInsertWithTrans: ' + error);
        }
    }

    onSelect() {
        const select = 'SELECT * FROM names WHERE id < 20';
        const data = this.sqlite.select(select);
        alert(`Received data: ${JSON.stringify(data)}`);
    }

    onReset() {
        const reset = 'DELETE FROM names';
        this.sqlite.execute(reset);
    }
    async blobTest() {
        const createCmd = 'CREATE TABLE blobs (id INT, name TEXT, data blob, PRIMARY KEY (id))';
        await this.sqlite.execute(createCmd);
        const insert = 'INSERT INTO blobs (id, name, data) VALUES (?, ?, ?)';
        const imageSource = ImageSource.fromFileOrResourceSync('~/assets/maltobarbar.jpg');
        console.log('imageSource', imageSource);
        const byteArrayOutputStream = new java.io.ByteArrayOutputStream();
        imageSource.android.compress(android.graphics.Bitmap.CompressFormat.JPEG, 100, byteArrayOutputStream);
        await this.sqlite.execute(insert, [0, 'test', byteArrayOutputStream]);
        console.log('done writing blob!', byteArrayOutputStream);
        const blob = this.sqlite.each(
            'select * from blobs',
            null,
            (err, result) => {
                console.log('read', result);
                const data = result.data;
                const bmp = android.graphics.BitmapFactory.decodeByteArray(data, 0, data.length);
                console.log('decoded image', bmp.getWidth(), bmp.getHeight());
                this.imageSource = new ImageSource(bmp);
            },
            null
        );
    }
    async typeORMTest() {
        const filePath = path.join(knownFolders.documents().path, 'db.sqlite');
        deleteDatabase(filePath);
        console.log('typeORMTest');
        installMixins();
        const connection = await createConnection({
            database: filePath,
            type: 'nativescript' as any,
            entities: [ImageTest],
            logging: true,
        });
        await connection.synchronize(false);
        const imageSource = ImageSource.fromFileOrResourceSync('~/assets/maltobarbar.jpg');
        console.log('imageSource', imageSource);
        const image = new ImageTest();
        image.width = imageSource.width;
        image.height = imageSource.height;
        if (global.isAndroid) {
            const byteArrayOutputStream = new java.io.ByteArrayOutputStream();
            imageSource.android.compress(android.graphics.Bitmap.CompressFormat.JPEG, 100, byteArrayOutputStream);
            image.data = byteArrayOutputStream.toByteArray();
        } else {
            const data = UIImageJPEGRepresentation(imageSource.ios, 1);
            image.data = data;
        }
        console.log('saving image');
        await image.save();
        console.log('saving image done');
        const results = await ImageTest.find({
            order: {
                id: 'DESC',
            },
            take: 10,
        });
        console.log('images', results);
    }
}

const generateData = (length: number) => {
    let i = 0;
    const data: DataExample[] = [];
    while (i < length) {
        data.push({ id: i, name: `${Math.random() + i} Test data` });
        ++i;
    }
    console.log('Generated ' + i + ' data items');
    return data;
};
