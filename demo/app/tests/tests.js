var MtmobileSqlite = require("nativescript-mtmobile-sqlite").MtmobileSqlite;
var mtmobileSqlite = new MtmobileSqlite();

describe("greet function", function() {
    it("exists", function() {
        expect(mtmobileSqlite.greet).toBeDefined();
    });

    it("returns a string", function() {
        expect(mtmobileSqlite.greet()).toEqual("Hello, NS");
    });
});