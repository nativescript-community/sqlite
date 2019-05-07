const MtmobileSqlite = require("nativescript-mtmobile-sqlite");
const fs = require("tns-core-modules/file-system");

const expectFunc = func => {
    it("is defined", () => expect(func).toBeDefined());
    it("is a function", () => expect(func).toEqual(jasmine.any(Function)));
};

const expectToThrow = func => {
    it("can throw", () => expect(func).toThrow());
};

const expectNotToThrow = func => {
    it("shouldn't throw", () => expect(func).not.toThrow());
};

const expectProperty = (prop, obj) => {
    it(`has property ${prop}`, () => expect(obj[prop]).toBeDefined());
};

const expectReturnVoid = func =>
    it("returns void", () => expect(func()).toBe(undefined));

const expectReturnNumber = func =>
    it("returns a number", () => expect(func()).toEqual(jasmine.any(Number)));

const expectValidResult = (func, expected) =>
    it("should return valid result", () => expect(func()).toEqual(expected));

const filePath = fs.path.join(
    fs.knownFolders.documents().getFolder("db").path,
    "test.sqlite"
);

const insertQuery = "INSERT INTO names (id, name) VALUES (?, ?)";

const generateFourDataRecords = () => {
    let data = [];
    let i = 1;
    while (i < 5) {
        data = [...data, { id: i, name: `With id: ${i}` }];
        i++;
    }
    return data;
};

describe("openOrCreate =>", function() {
    // 1
    expectFunc(MtmobileSqlite.openOrCreate);
    expectToThrow(() => MtmobileSqlite.openOrCreate("\\\\"));
    describe("Sqlite", () => {
        // 4
        const sqlite = MtmobileSqlite.openOrCreate(filePath);
        it("is defined", () => expect(sqlite).toBeDefined());
        expectProperty("close", sqlite);
        expectProperty("execute", sqlite);
        expectProperty("get", sqlite);
        expectProperty("getArray", sqlite);
        expectProperty("getVersion", sqlite);
        expectProperty("isOpen", sqlite);
        expectProperty("select", sqlite);
        expectProperty("selectArray", sqlite);
        expectProperty("setVersion", sqlite);
        expectProperty("transaction", sqlite);
        MtmobileSqlite.deleteDatabase(filePath);
    });

    describe("Sqlite.close =>", () => {
        // 15
        const sqlite = MtmobileSqlite.openOrCreate(filePath);
        expectFunc(sqlite.close);
        it("db should be open before calling close", () =>
            expect(sqlite.isOpen()).toEqual(true));
        expectReturnVoid(sqlite.close);
        it("db should be closed after calling close", () =>
            expect(sqlite.isOpen()).toEqual(false));
        it("any call to db after close should throw", () =>
            expect(sqlite.getVersion).toThrow());
        MtmobileSqlite.deleteDatabase(filePath);
    });

    const sqlite = MtmobileSqlite.openOrCreate(filePath);
    describe("Sqlite.execute =>", () => {
        // 21
        expectFunc(sqlite.execute);
        expectToThrow(() => sqlite.execute("BAD QUERY"));
        expectToThrow(() => sqlite.execute("SELECT * FROM names"));
        expectReturnVoid(() =>
            sqlite.execute(
                "CREATE TABLE names (id INT, name TEXT, PRIMARY KEY (id))"
            )
        );
        expectNotToThrow(() => sqlite.execute(insertQuery, [0, "Joe"]));
    });

    describe("Sqlite.get =>", () => {
        // 27
        expectFunc(sqlite.get);
        expectToThrow(() => sqlite.get("BAD QUERY"));
        expectValidResult(() => sqlite.get("SELECT * FROM names"), {
            id: 0,
            name: "Joe",
        });
        expectValidResult(
            () => sqlite.get("SELECT * FROM names WHERE id = (?)", 2),
            null
        );
    });

    describe("Sqlite.getArray =>", () => {
        // 32
        expectFunc(sqlite.getArray);
        expectToThrow(() => sqlite.getArray("BAD QUERY"));
        expectValidResult(() => sqlite.getArray("SELECT * FROM names"), [
            0,
            "Joe",
        ]);
        expectValidResult(
            () => sqlite.getArray("SELECT * FROM names WHERE id = (?)", 2),
            null
        );
    });

    describe("Sqlite.select =>", () => {
        // 37
        expectFunc(sqlite.select);
        expectToThrow(() => sqlite.select("BAD QUERY"));
        expectValidResult(() => sqlite.select("SELECT * FROM names"), [
            { id: 0, name: "Joe" },
        ]);
        expectValidResult(
            () => sqlite.select("SELECT * FROM names WHERE id = (?)", 2),
            []
        );
    });

    describe("Sqlite.selectArray =>", () => {
        // 42
        expectFunc(sqlite.selectArray);
        expectToThrow(() => sqlite.selectArray("BAD QUERY"));
        expectValidResult(() => sqlite.selectArray("SELECT * FROM names"), [
            [0, "Joe"],
        ]);
        expectValidResult(
            () => sqlite.selectArray("SELECT * FROM names WHERE id = (?)", 2),
            []
        );
    });

    describe("Sqlite version", () => {
        // 47
        describe("Sqlite.getVersion =>", () => {
            expectFunc(sqlite.getVersion);
            expectReturnNumber(sqlite.getVersion);
        });
        describe("Sqlite.setVersion =>", () => {
            expectFunc(sqlite.setVersion);
            expectReturnVoid(sqlite.setVersion);
        });
        expectValidResult(sqlite.getVersion, 0);
        expectReturnVoid(() => sqlite.setVersion(1));
        expectValidResult(sqlite.getVersion, 1);
    });

    describe("Sqlite.transaction =>", () => {
        // 56
        expectFunc(sqlite.transaction);
        expectToThrow(() => sqlite.transaction("BAD QUERY"));
        const insertPromise = record =>
            new Promise((res, rej) => {
                try {
                    sqlite.execute(insertQuery, [record.id, record.name]);
                    res();
                } catch (error) {
                    rej(error);
                }
            });
        const expectLength = (promises, length, done) =>
            Promise.all(promises)
                .then(_ => {
                    expect(sqlite.select("SELECT * FROM names").length).toEqual(
                        length
                    );
                })
                .then(done, done);
        it("should rollback if there are errors", done => {
            let promises = [];
            sqlite.transaction(cancel => {
                generateFourDataRecords().forEach(record => {
                    if (record.id === 4) {
                        // CONSTRAINT ERROR
                        record.id = 0;
                    }
                    promises = [...promises, insertPromise(record)];
                });
            });
            return expectLength(promises, 1, done);
        });
        it("should rollback if cancel is called", done => {
            let promises = [];
            sqlite.transaction(cancel => {
                promises = generateFourDataRecords().map(insertPromise);
                expectLength(promises, 5);
                cancel();
            });
            expectLength(promises, 1, done);
        });
        it("should commit if there are no errors", done => {
            let promises = [];
            sqlite.transaction(cancel => {
                generateFourDataRecords().forEach(record => {
                    promises = [...promises, insertPromise(record)];
                });
            });
            return expectLength(promises, 5, done);
        });
        describe("nested transactions", () => {
            expectNotToThrow(() =>
                sqlite.transaction(() => {
                    sqlite.transaction(() => {});
                })
            );
            expectToThrow(() =>
                sqlite.transaction(() => {
                    sqlite.transaction(() => {
                        throw new Error("");
                    });
                })
            );
            it("should bubble up inner errors", () => {
                let e;
                try {
                    sqlite.transaction(() => {
                        sqlite.transaction(() => {
                            throw new Error("CUSTOM ERROR");
                        });
                    });
                } catch (error) {
                    e = error;
                } finally {
                    expect(e.message).toContain("CUSTOM ERROR");
                }
            });
        });
    });

    describe("Sqlite.isOpen =>", () => {
        // 61
        expectFunc(sqlite.isOpen);
        expectValidResult(sqlite.isOpen, true);
        expectValidResult(() => {
            sqlite.close();
            return sqlite.isOpen();
        }, false);
    });
});

describe("deleteDatabase =>", function() {
    // 65
    expectFunc(MtmobileSqlite.deleteDatabase);
    expectValidResult(() => MtmobileSqlite.deleteDatabase("\\\\"), false);
    expectValidResult(() => MtmobileSqlite.deleteDatabase(filePath), true);
});
