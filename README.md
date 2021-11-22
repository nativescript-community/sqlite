# Nativescript: Akylas Sqlite

[![npm](https://img.shields.io/npm/v/@nativescript-community/sqlite.svg)](https://www.npmjs.com/package/@nativescript-community/sqlite)
[![npm](https://img.shields.io/npm/dt/@nativescript-community/sqlite.svg?label=npm%20downloads)](https://www.npmjs.com/package/@nativescript-community/sqlite)

## Installation

```
ns plugin add @nativescript-community/sqlite
```

## Usage

You should take care of wrapping sqlite calls to your preferred async option (promises, observables, async/await). And catch any exceptions thrown.

```typescript
import { openOrCreate, deleteDatabase } from "@nativescript-community/sqlite";

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
