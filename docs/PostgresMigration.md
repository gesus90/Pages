# PostgreSQL migration

PostgreSQL replaces DuckDB (decided on 2026-11-03). Until the switch both exist
side by side; `docs/DatabaseExecutor.md` describes the facade they share.

## Schema

`backend/database/postgres/migrations/001_baseline.sql` holds the end state of
the DuckDB migrations 001 to 088: tables, primary keys, unique and check
constraints, indexes, defaults, the sequences, the one view and the rows a fresh
database starts with. The history is not replayed. The DuckDB schema has no
foreign keys, so PostgreSQL has none either.

`Database.migrate` runs both dialects. `migrationsFor(database.dialect)` picks
the scripts; PostgreSQL counts its own in `postgres_schema_migrations`. It runs no
`CHECKPOINT`: that only protects DuckDB's write-ahead log and needs extra rights
here.

Until the switch every new DuckDB migration needs a matching PostgreSQL migration
(`AGENTS.md`).

## Types

| DuckDB            | PostgreSQL         | Remark                                                                                |
| ----------------- | ------------------ | ------------------------------------------------------------------------------------- |
| `TEXT`, `VARCHAR` | `TEXT`             | DuckDB reports both as `VARCHAR`.                                                     |
| `INTEGER`         | `INTEGER`          |                                                                                       |
| `BIGINT`          | `BIGINT`           |                                                                                       |
| `DOUBLE`          | `DOUBLE PRECISION` |                                                                                       |
| `BOOLEAN`         | `BOOLEAN`          | The facade reads and binds the integers `0` and `1` in both.                          |
| `BLOB`            | `BYTEA`            | The facade returns a `Buffer` in both.                                                |
| `TIMESTAMP`       | `TIMESTAMP`        | No column uses it: times are `TEXT` in the format `YYYY-MM-DD HH:MM:SS`, always UTC.  |
| `JSON`            | `JSON`             | No column uses it: JSON documents are `TEXT` (`*_json`), which this move keeps as is. |

## Time functions

`utc_now()` and `utc_after(time_shift)` are persistent functions of the baseline,
where DuckDB creates macros per connection. Both answer with the same text. They
use the start of the transaction, truncate fractions of a second and ignore the
time zone of the session.

## Comparison

`pnpm run postgres:check` migrates a new DuckDB file and a new PostgreSQL database
and compares tables, columns with order, type, nullability and default, primary
keys, unique constraints, foreign keys, check constraints, indexes, sequences,
view columns and the rows of the fresh databases without their time stamps. It
fails on a difference that is not in this list, and on an entry of the list
(`SCHEMA_DEVIATIONS` in `scripts/postgres-check/schema-comparison.ts`) that no
longer occurs.

| Difference                                             | Reason                                                                                                    |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `schema_migrations` exists only in DuckDB              | The version table of the DuckDB migrations; PostgreSQL has its own migrations and counts them separately. |
| `postgres_schema_migrations` exists only in PostgreSQL | A table of its own, so a copied DuckDB version table can never count as applied PostgreSQL migrations.    |

## Database locale

`Database.connect` refuses a database whose encoding is not UTF8 or whose locale
is not `C.UTF-8` (`PostgresLocaleError`). Every `ORDER BY`, `<` and `lower()` follows
the locale of the database, and a cluster defaults to the locale of its system.
Under `de_DE` lists would sort differently from DuckDB without any error. Create
the database with:

```sql
CREATE DATABASE pages TEMPLATE template0 ENCODING 'UTF8' LOCALE_PROVIDER libc LOCALE 'C.UTF-8';
```

## Repository SQL

A statement is written once for both databases. `sqlForDialect` is for what cannot
be the same, and the core and project repositories do not need it. These rules
keep the results equal:

- `NULL` sorts first in ascending and last in descending order in DuckDB, a session
  setting of the worker. PostgreSQL does the opposite and has no such setting, so
  a nullable sort key says `NULLS FIRST` or `NULLS LAST`.
- A list ends its `ORDER BY` on a unique key. Rows with equal sort keys otherwise
  come back in the physical order, and an `UPDATE` changes that in PostgreSQL only.
- `to_days` and `to_minutes` exist only in DuckDB. Use `$days * INTERVAL '1 day'`
  or a literal such as `INTERVAL '-1 minute'`.
- `sha256(data)` answers with text in DuckDB and with bytes in PostgreSQL. The
  reader accepts both.
- A parameter needs a type from its context: `$value IS NULL` alone fails in
  PostgreSQL with `42P18`.

| Area                                          | State                                             |
| --------------------------------------------- | ------------------------------------------------- |
| Files directly in `repositories/`, `project/` | Ported, compared by `postgres:check` (PAGE-214)   |
| `task/`, `wiki/`                              | PAGE-215; `FOREIGN_GAPS` lists what still differs |
| Agents, plans and runners                     | PAGE-216                                          |
| Chat, Discord, MCP and Mobile                 | PAGE-217                                          |

`postgres:check` reads the public methods and exported functions of a ported area
from its source, runs flows through them on PostgreSQL and on DuckDB, and compares
every result. It masks only times in the stored format and generated identifiers.
It fails on a method no flow reaches, on any difference outside `FOREIGN_GAPS`, and
on an entry of that list that no longer differs.

These differences remain, because no repository statement can remove them:

- PostgreSQL cannot store the character U+0000 in text and refuses the statement;
  DuckDB stores it.
- A fraction bound to an integer column is refused by PostgreSQL and rounded by
  DuckDB. The services validate these numbers first.
- `upper('ß')` is `ß` in PostgreSQL and `ẞ` in DuckDB.
- `execute` with several statements and no values is all or nothing in PostgreSQL;
  DuckDB keeps the statements before a failing one. Only migrations use this form,
  and they run in a transaction.
