{{ load:../../tools/readme/edit-warning.md }}
{{ template:title }}
{{ template:badges }}
{{ template:description }}

{{ template:toc }}

## Installation
Run the following command from the root of your project:

`ns plugin add {{ pkg.name }}`

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

## Platforms sqlite versions

*  [Android](https://stackoverflow.com/a/4377116)
*  [iOS](https://github.com/yapstudios/YapDatabase/wiki/SQLite-version-(bundled-with-OS))

