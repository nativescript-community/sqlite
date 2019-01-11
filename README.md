# Nativescript: MtMobile Sqlite

[![Build Status](https://travis-ci.com/TestJG/nativescript-mtmobile-sqlite.svg?branch=master)](https://travis-ci.com/TestJG/nativescript-mtmobile-sqlite) [![npm version](https://badge.fury.io/js/nativescript-mtmobile-sqlite.svg)](https://badge.fury.io/js/nativescript-mtmobile-sqlite)

## Installation

```
tns plugin add nativescript-mtmobile-sqlite
```

## Usage

You should take care of wrapping sqlite calls to your preferred async option (promises, observables, async/await). And catch any exceptions thrown.

``` TypeScript
import { openOrCreate, deleteDatabase } from "nativescript-mtmobile-sqlite";

const sqlite = openOrCreate("path/to/db");
sqlite.execute("CREATE TABLE names (id INT, name TEXT)");
sqlite.transaction(cancelTransaction => {
    // Calling cancelTransaction will rollback all changes made to db
    names.forEach((name, id) =>
        sqlite.execute(
            "INSERT INTO names (id, name) VALUES (?, ?)",
            [id, name]
        )
    );
});
```
