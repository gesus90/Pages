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

`try_date(date_text)` (`002_try_date.sql`) is the date in a text, or `NULL`. DuckDB
answers with `TRY_CAST`, which PostgreSQL does not have, and its own date input
reads other forms such as `Jan 1 2026`. The function follows what DuckDB accepts.
Callers only compare the result, because a year beyond the range of a PostgreSQL
date comes back as infinity.

## JSON functions

`json_extract_string(document, path)` and `json_tree(document, path)`
(`003_json_functions.sql`, `007_json_string_with_nul.sql`) have the names of the DuckDB functions, so a statement
is the same in both. A path has the form `$.a.b`; `json_tree` without a path starts
at the document. PostgreSQL refuses a whole JSON document that holds the escape
`\u0000`, even for another key. JSON.stringify writes that escape for a U+0000, and
one such plan would break every list of plans, so both functions read the document
with a marker in its place. `json_extract_string` puts the escape back into an
object or array it returns.

## Data transfer

`pnpm run db:transfer -- --from <duckdb-file> --to <postgres-url>` copies a DuckDB
file into a PostgreSQL database and compares both. `--verify-only` compares without
writing, for example once more right before the switch.

The steps of a switch:

1. Stop Pages cleanly and keep a backup of the file. The command refuses a file with
   a write-ahead log, and a file that does not have exactly the migrations of this
   version: run this version on it once first.
2. Create an empty database with the locale below. Leave the password out of the URL
   and set `PGPASSWORD`: `pnpm run` prints its command line, and the process list
   shows it.
3. Run the command. It opens the file read-only and writes nothing next to it.
4. Switch only after exit code 0. Exit code 1 is a deviation or a failure, exit code 2
   wrong usage. After a failed copy, drop the database and start with a new one.

The command migrates the target and refuses one that holds business data: any table
of something else, or a row a migration did not write, including a seeded row that
was changed later. It tells them apart by the transaction of the row (`xmin`), which
for an unchanged seeded row is the one of its migration.

It copies table by table in the order of the foreign keys of the target (there are
none today), each table in one transaction and in blocks of at most 100 rows or
16 MiB. The seeded rows are replaced by those of the source. Afterwards it reads every
table again on both sides, sorted by the primary key, and compares the row count and
a SHA-256 over all columns. A sequence is set to the value DuckDB hands out next, and
this value is compared, too. The version tables stay out: PostgreSQL counts its own
migrations.

The report holds names and numbers only, with the duration per table and in total. The
total, plus stopping and starting Pages, is the expected downtime of the switch. On a
failure the command prints the SQLSTATE and no driver text, since that can quote a
value. It keeps the facade from logging for the same reason.

The transfer removes U+0000 from text (see [U+0000 in text](#u0000-in-text)):

- The command removes it itself, and the checksum of the source is taken over the
  rows without the character and in the order of the target. These are the values the
  target must hold, so every other difference in any row or column still ends with
  exit code 1.
- The report lists table, column, values and characters for each column that lost the
  character, and the sum. A source without it reports `0 values` explicitly.
- Binary values and the escape `\u0000` of six characters, also as `\\u0000`, stay.
- The command stops with exit code 1 on the texts a save refuses, by the same rule (see
  [U+0000 in text](#u0000-in-text)). It names table and column; the value has to be
  corrected in the source first.
- Two keys that differ only by the character collide in the target. The command then
  stops with SQLSTATE `23505`, also for a unique column that is no primary key, and
  with `23514` where a check constraint refuses the cleaned value.

## Running backup

The data is backed up while Pages runs, and a recovery to a point in time is checked.
On top of the base backup the WAL archive holds every change, so at most the last
5 minutes (`archive_timeout = 300`) can be lost when the server's own disk fails. The
oldest kept base backup limits how far back a recovery can go: 7 days with the default.

| Part                                           | Task                                                                                        |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `deploy/postgres/postgresql-pages.conf`        | Settings of the cluster, including `archive_timeout` and `archive_command`.                 |
| `deploy/postgres/archive-wal.sh`               | Stores a WAL file in `/mnt/Data/PagesPostgres/wal`, after checking the mount by its UUID.   |
| `deploy/postgres/base-backup.sh`               | `pg_basebackup` to `/mnt/Data/PagesPostgres/base`, keeps the last 7, removes the older WAL. |
| `deploy/postgres/backup.env.example`           | Mount UUID, directory and connection of the two commands below.                             |
| `pages-postgres-base-backup.{service,timer}`   | Base backup every day at 03:30.                                                             |
| `pages-postgres-restore-check.{service,timer}` | `pnpm run postgres:restore-check` every day at 04:30.                                       |

### Setup at the switch

Nothing of this is set up yet; the productive setup happens at the switch. All of it runs
as one user, who owns `/mnt/Data/PagesPostgres` and the cluster and reads the
configuration of Pages.

1. With `/mnt/Data` mounted, create `/mnt/Data/PagesPostgres/wal` and `base`, mode 0700.
   Neither script creates the root: on a missing disk that would land on the system disk.
2. Copy `postgresql-pages.conf` next to `postgresql.conf`, replace `@CHECKOUT@` and
   `@MOUNT_UUID@` and add `include = 'postgresql-pages.conf'`. Restart the server:
   `wal_level` and `archive_mode` take effect only then.
3. Create the role of the base backup and allow it in `pg_hba.conf`:

   ```sql
   CREATE ROLE pages_backup LOGIN REPLICATION PASSWORD '<password>';
   ```

   ```text
   host replication pages_backup 127.0.0.1/32 scram-sha-256
   ```

4. In the database `pages`, because a right on a function holds per database, let the role
   of `databaseUrl` close a WAL file. This role must own the tables and may create a schema
   in the database, which the owner of the database can:

   ```sql
   GRANT EXECUTE ON FUNCTION pg_switch_wal() TO pages;
   ```

5. Copy `backup.env.example` to `/etc/pages/postgres-backup.env` and put the password of
   `pages_backup` into the file `PGPASSFILE` names, both mode 0600.
6. Copy the four units to `/etc/systemd/system`, replace `@USER@`, `@CHECKOUT@`, `@CONFIG@`
   and `@NODE_BIN@` and enable both timers.
7. Start the base backup service once, then the restore check service once. A backup only
   counts after a check passed.

While `archive-wal.sh` fails, for example with the disk missing, PostgreSQL keeps the WAL
in its own `pg_wal` and retries. Nothing is lost, but that disk fills up, and the restore
check fails. `pg_stat_archiver` shows the failures.

### Restore check

`pnpm run postgres:restore-check -- --config <config.toml>` reads `databaseUrl` from the
configuration and `PAGES_POSTGRES_BACKUP_ROOT` and `PAGES_POSTGRES_BACKUP_UUID` from the
environment. Exit code 0 means passed, 1 failed, 2 wrong usage. The steps:

1. Check the mount and compare the newest finished base backup with its manifest
   (`pg_verifybackup`, SHA-256 per file). A damaged backup ends the command here; it does
   not fall back to an older one.
2. Fix a point in time on the running source. A row is confirmed in
   `pages_restore_check.markers`, then every table of `public` is locked in `SHARE MODE`
   for the moment it takes to count them and to read the clock. A second row follows after
   that time, and the WAL file is closed and awaited in the archive.
3. Copy the backup to `<root>/restore-check-<random>`, start it on a free port with a
   configuration of its own and replay the archive to that time.
4. Compare the number of tables and the rows per table with the counts of step 2. The first
   row must be there and the second must not. Then stop and delete the instance.

**The lock.** A count of a running database fits no point in time, so writers wait for
that moment. The `LOCK` statement gives up after 800 ms, below the `deadlock_timeout` of
1 s, so that in a deadlock the server never ends a writer; do not lower that setting. It
tries again after 15 s, up to five times, and then fails in the step `source` with the
code `57014`. A vacuum keeps this lock waiting as well. Each count is limited to 5 s.

**The markers.** They lie in a schema of their own, which the command creates, so they
change neither the tables it counts nor a transfer. It keeps only the two rows of its
last run. The schema is no migration: Pages does not know it, and DuckDB has no counterpart.

**The instance.** It accepts only its private socket, without a password, since role and
password come from the source; its port rejects every connection. `archive_mode` is off,
so it never writes into the archive. It works on a copy, so the backup stays unchanged. A
directory left by a killed run goes at the next start; if a process still uses it, the
check fails instead.

**The result** is the log event `postgres.restore_check.passed` or
`postgres.restore_check.failed`, with the failed step, in
`<config directory>/postgres-restore-check/log/`, because a running Pages holds the lock on
its own log directory. The output of the command reaches the journal as well.

### Recovery

For a real recovery, stop the server and keep its directory. Copy a base backup that is
older than the wanted time into an empty data directory, mode 0700, and add `recovery.signal`
and these settings:

```text
restore_command = 'cp /mnt/Data/PagesPostgres/wal/%f %p'
recovery_target_time = '<time with zone>'
recovery_target_action = 'promote'
```

Recovery fails when the archive holds no commit after that time. To recover up to the last
archived change, leave `recovery_target_time` out. Start the server and remove both settings
afterwards. The new timeline goes into the archive, so take a new base backup right away.

### Limits

- `/mnt/Data` is a disk in the same machine. The backup protects against a failed system
  disk and against a mistake, not against fire or theft. A copy outside the house is an
  open decision.
- Changes of the last 5 minutes can be missing, and more when the archive has been failing.
- The check needs the running source and compares numbers of rows, not their content.
  Equal counts with changed content would only show as a checksum error of the backup
  (`pg_verifybackup`) or the WAL.
- The check needs free space for one more copy of the base backup on `/mnt/Data`.
- Attachments and other files of Pages are not part of this backup.

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

## U+0000 in text

PostgreSQL cannot store the character U+0000 in text. A value that a statement
writes loses it on PostgreSQL; a value that a statement compares never does. DuckDB
keeps the character. This is a deliberate change of data, decided on 2026-11-04, and
it covers saving and `db:transfer`, never reading or identity. The one difference
between the databases that is meant to stay is this removal.

`bindStatement` decides by what the statement does with each parameter
(`parameterUses` in `PostgresParameterUse.ts`), and only for a text with the character:

| Use        | Where                                                                                                                                       | Value                                                                            |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `written`  | Alone in a row of `INSERT`, `col = $value` or `col = COALESCE($value, col)`, in no column of an `ON CONFLICT` target                        | Cleaned, counted                                                                 |
| `compared` | `SELECT`, `WITH`, `DELETE`, `WHERE`, `FROM`                                                                                                 | Replaced by a text no row holds, so it finds nothing, and `COUNT(*)` answers `0` |
| `unclear`  | Anything else: a name with two kinds of use, a value inside an expression, `ON CONFLICT` without a target, `RETURNING`, any other statement | Sent as it is, PostgreSQL refuses with `22021`, nothing changes                  |

- Only the character goes. All other characters and binary values stay, and so does
  the escape `\u0000` of six characters, also as `\\u0000`. A valid JSON document holds
  no such character, so it passes unchanged.
- `textWithoutNul` in `PostgresText.ts` holds the rule for written values. It refuses,
  with `22021` and no content, where taking the character out would change the number or
  place of the real escapes `\u0000`, or make valid JSON of an invalid text. `db:transfer`
  uses the same function, so both stop on the same texts. This also stops a plain text
  that happens to be JSON without the character, such as `5` and the character.
- A query that would return a compared value fails with `NulTextQueryError`.
- Each statement that lost a character logs `database.text.nul_removed` with the number
  of characters and no content. A statement that was rolled back counts, too.
- A key written without a conflict target can collide with one that has no character
  (`23505`); that refuses and merges nothing. An `INSERT` that should keep a text value
  names its conflict target, or checks first as `ChatSessionRepository.append` does,
  because DuckDB cannot name the target of an `INSERT … SELECT`.
- At the identity boundaries, a name or credential with the character is refused before
  any statement, on both databases, like unknown credentials: login, session and agent
  tokens (`holdsNulCharacter`), usernames and email addresses of accounts and the setup,
  device identifiers and push tokens of Pica Mobile.
  `LoginThrottle` counts such a name as its own: it never reaches a password check, so
  its spellings gain no guess.
- A value that a statement both saves and compares has two names, so that saving it
  still works (`$description` and `$new_description` in `WorkItemWriteRepository`). The
  compared one keeps the character, so a second save of the same text cannot find the
  first by it. The statement therefore also accepts the stored text that equals
  `textWithoutNul` of the new text, where `removes_nul_on_save()` is true: PostgreSQL
  yes, DuckDB no. It stays one conditional statement, with all its other conditions, so
  nothing is written to get an answer, and a concurrent change is seen when PostgreSQL
  re-reads the locked row. This applies to these two saves only: a stored `ab` accepts a
  save of `a\0b` on PostgreSQL, and is a conflict on DuckDB. No read or other comparison
  treats `a\0b` as `ab`. `postgres:check` proves this with two connections
  (`repeated-save-checks.ts`).
- A statement text is no bound value and stays as it is; repositories interpolate only
  fixed fragments.

## Repository SQL

A statement is written once for both databases. `sqlForDialect` is for what cannot
be the same, and the core and project repositories do not need it. These rules
keep the results equal:

- `NULL` sorts first in ascending and last in descending order in DuckDB, a session
  setting of the worker. PostgreSQL does the opposite and has no such setting, so
  a nullable sort key says `NULLS FIRST` or `NULLS LAST`.
- Permissions and memberships keep the order they were saved in, in a column
  `position` (migration 089). It used to rest on the physical order of the rows,
  which `admin.roles.list` and `admin.users.list` show.
- Tickets, their history, links and checklist items, milestones with their
  dependencies, comments and page versions keep the order they were created in inside
  one second, in a column `creation_order` from the sequence `row_creation_order`
  (migration 090). Existing rows took it from the physical order. Ticket lists use
  `created_at` and the number of the ticket instead.
- Personal tokens, Discord attempts and deliveries, deliveries and events of Pica Mobile,
  steers, selections and chat attachments keep the order they were created in, in the
  same column (migration 092). It decides the latest attempt, the message a change merges
  into, what is handed out first and which events an account keeps.
- Plan runs, their reservations and retained history packets of a runner keep the
  order they were created in, in the same column (migration 091). It decides which
  run takes a working copy first after a restart, which holder a waiting run names
  and which packet of a job comes first.
- Projects, goals, dates, accounts and sessions keep the order they were created in, in
  the same column (migration 093). A person changing their profile moves behind others
  of the same name, because that write used to move the row to the end of the table.
  Members of a project with the same name follow the accounts, as the old join did.
  In lists of about 30 to 127 rows the old sort of DuckDB mixed ties in a way that
  depended on the other rows; that order is stored nowhere and does not come back.
- A list ends its `ORDER BY` on a unique key. Rows with equal sort keys otherwise
  come back in the physical order, and an `UPDATE` changes that in PostgreSQL only.
- `to_days` and `to_minutes` exist only in DuckDB. Use `$days * INTERVAL '1 day'`
  or a literal such as `INTERVAL '-1 minute'`.
- `sha256(data)` answers with text in DuckDB and with bytes in PostgreSQL. The
  reader accepts both.
- A parameter needs a type from its context: `$value IS NULL` fails in PostgreSQL
  with `42P18`, also when a later use would give it one. Write
  `CAST($value AS TEXT) IS NULL`.
- `LIKE` without `ESCAPE` treats a backslash as an escape in PostgreSQL and as itself
  in DuckDB. Name the escape and escape the backslash in the bound text.
- `rowid` and `regexp_matches` exist only in DuckDB; `translate` tests for a set of
  characters in both.
- A parameter next to a whole number takes the type `integer`: `$days * 86400000`
  overflows at 25 days. PostgreSQL computes it ahead, also when no row is touched;
  DuckDB only for a row. Write `CAST($days AS BIGINT)`. A parameter that an earlier
  part of the statement already typed as `BIGINT` needs no cast; PostgreSQL reads the
  `WHERE` of an `UPDATE` first.
- `RETURNING` has no order in either database, and DuckDB has no `UPDATE` inside a
  `WITH`. A method that returns a list from it sorts in TypeScript.
- `CHECKPOINT` belongs to the file of DuckDB and needs extra rights in PostgreSQL.
- `QUALIFY` exists only in DuckDB: filter the window function in an outer query.
- Parallel statements through `Promise.all` fail in a DuckDB transaction with
  `cannot start a transaction within a transaction` when they are its first statements,
  and run in PostgreSQL. Run them one after the other when a transaction can call the
  method. `AgentConnectionScopeRepository.list` and `WikiSearchRepository.search` keep
  the parallel form, because no caller uses them in a transaction.
- A reservation with a run comes before one without, then by creation. So a real
  collision queues a plan even where an old reservation has no snapshot to compare with.

| Area                                          | State                                           |
| --------------------------------------------- | ----------------------------------------------- |
| Files directly in `repositories/`, `project/` | Ported, compared by `postgres:check` (PAGE-214) |
| `task/`, `wiki/`                              | Ported, compared by `postgres:check` (PAGE-215) |
| `agent/`, `agents/`, `runner/`, `remote/`     | Ported, compared by `postgres:check` (PAGE-216) |
| `chat/`, `discord/`, `mcp/`, `mobile/`        | Ported, compared by `postgres:check` (PAGE-217) |

`postgres:check` reads the public methods and exported functions of a ported area
from its source, runs flows through them on PostgreSQL and on DuckDB, and compares
every result. It masks only times in the stored format and generated identifiers.
It fails on a method no flow reaches and on any difference. A flow reverses the
physical order of a table in PostgreSQL before it reads a list, so a list without a
unique last sort key shows as a difference.
An index read backwards undoes that reversal, so a list sorted descending is read in
both physical orders.

These differences remain, because no repository statement can remove them:

- U+0000 in a text, see [U+0000 in text](#u0000-in-text). The removal is decided, not
  left over.
- A fraction bound to an integer column is refused by PostgreSQL and rounded by
  DuckDB. The services validate these numbers first, except the sort order of the
  board, whose statement casts through `DOUBLE PRECISION` like DuckDB does.
- `upper('ß')` is `ß` in PostgreSQL and `ẞ` in DuckDB.
- `json_extract_string` returns a string with a U+0000 as the character in DuckDB and
  as a text no identifier has in PostgreSQL (`007_json_string_with_nul.sql`). Callers
  only compare it with a fixed word or an identifier.
- `INSERT … ON CONFLICT DO UPDATE` with `NULL` for a `NOT NULL` column that the update
  does not set is refused by PostgreSQL before it finds the conflict; DuckDB takes the
  update. The types of the repositories do not allow such a value.
- `execute` with several statements and no values is all or nothing in PostgreSQL;
  DuckDB keeps the statements before a failing one. Only migrations use this form,
  and they run in a transaction.
