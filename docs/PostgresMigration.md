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

The SQL of the repositories is not ported yet. These differences lie outside the
schema and concern that work:

- DuckDB sorts `NULL` first in ascending and last in descending order, a session
  setting of the worker. PostgreSQL does the opposite and has no such setting.
- Text sorts by the collation of the PostgreSQL database, in DuckDB by bytes.
- `to_minutes` and `to_days`, which repositories pass to `utc_after`, exist only
  in DuckDB.
