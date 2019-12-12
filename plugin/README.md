# Nativescript: Akylas Sqlite

[![Build Status](https://travis-ci.com/TestJG/nativescript-akylas-sqlite.svg?branch=master)](https://travis-ci.com/TestJG/nativescript-akylas-sqlite) [![npm version](https://badge.fury.io/js/nativescript-akylas-sqlite.svg)](https://badge.fury.io/js/nativescript-akylas-sqlite)

## Installation

```
tns plugin add nativescript-akylas-sqlite
```

## Usage

You should take care of wrapping sqlite calls to your preferred async option (promises, observables, async/await). And catch any exceptions thrown.

``` TypeScript
import { openOrCreate, deleteDatabase } from "nativescript-akylas-sqlite";

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
