var MtmobileSqlite = require("nativescript-mtmobile-sqlite");

describe("openOrCreate", function() {
    it("exists", function() {
        expect(MtmobileSqlite.openOrCreate).toBeDefined();
    });
});

describe("deleteDatabase", function() {
    it("exists", function() {
        expect(MtmobileSqlite.deleteDatabase).toBeDefined();
    });
});
