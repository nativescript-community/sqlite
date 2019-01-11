import { Observable } from "tns-core-modules/data/observable";
import {
    openOrCreate,
    SQLiteDatabase,
    deleteDatabase,
} from "nativescript-mtmobile-sqlite";
import { path, knownFolders } from "tns-core-modules/file-system";

type DataExample = { id: number; name: string };

export class HelloWorldModel extends Observable {
    public message: string;
    sqlite: SQLiteDatabase;

    constructor() {
        super();
        this.resetDb();
        this.sqlite.setVersion(1);
        this.message = `version = ${this.sqlite.getVersion()}`;
    }

    resetDb() {
        const filePath = path.join(
            knownFolders.documents().getFolder("db").path,
            "dbname.sqlite"
        );
        deleteDatabase(filePath);
        this.sqlite = openOrCreate(filePath);
        const createCmd =
            "CREATE TABLE names (id INT, name TEXT, json TEXT, PRIMARY KEY (id))";
        this.sqlite.execute(createCmd);
    }

    insert(data: DataExample[]) {
        data.map((data, i) => {
            const insert = `INSERT INTO names (id, name, json) VALUES (?, ?, ?)`;
            // Uncomment to crash it
            if (i === 1000) {
                console.log("About to crash!");
                data.id = 0;
            }
            this.sqlite.execute(insert, [
                data.id,
                data.name,
                JSON.stringify(data),
            ]);
        });
    }

    onInsert() {
        try {
            this.insert(generateData(10000));
        } catch (error) {
            console.log("Error onInsert: " + error);
        }
    }

    onInsertWithTrans() {
        try {
            this.sqlite.transaction(() => this.insert(generateData(10000)));
        } catch (error) {
            console.log("Error onInsertWithTrans: " + error);
        }
    }

    onSelect() {
        const select = "SELECT * FROM names WHERE id < 20";
        const data = this.sqlite.select(select);
        console.log(`Received data: ${JSON.stringify(data)}`);
    }

    onReset() {
        const reset = "DELETE FROM names";
        this.sqlite.execute(reset);
    }
}

const generateData = (length: number) => {
    let i = 0;
    const data: DataExample[] = [];
    while (i < length) {
        data.push({ id: i, name: `${Math.random() + i} Test data` });
        ++i;
    }
    console.log("Generated " + i + " data items");
    return data;
};
