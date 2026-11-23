# PostgreSQL integration suite

`pnpm run test:integration` checks the SQL migrations and the database layer
against a real PostgreSQL server. It is separate from the backend unit tests
(`pnpm run test:backend`): the unit tests mock external services and report
coverage, this suite reports the behavior of the real server. Each has its own
evidence and neither replaces the other.

## What it needs

- PostgreSQL **18** programs in `/usr/lib/postgresql/18/bin` (`initdb`,
  `postgres`, `pg_isready`), as the Ubuntu and Debian packages install them.
  The suite refuses a server of another major version. It uses the same
  programs and process owner as `postgres:restore-check`.
- `python3` with `pidfd` support (Linux), which owns the server process.
- The `C.UTF-8` locale, which Pages requires of every database.

It does not use or change an installed PostgreSQL service, any configured
`databaseUrl`, live data or credentials.

## Isolation and cleanup

Every run starts its **own** server: `initdb` in a new directory below
`~/.pages/tmp/postgres-integration/run-*`, a free loopback port, no socket, new
random passwords for an administrator and for a role without superuser rights.
Every check creates its own empty database, owned by that role, so no check
sees the data of another. At the end the server is stopped through its owner
process, the run directory is removed with all databases and fixtures, and the
suite verifies that no process of the run remains. This happens after success,
after a failed check, after an error during setup and after `SIGINT` or
`SIGTERM`. Only the server log is kept, in the report directory.

All fixtures are synthetic and written by the checks themselves.

## Checks

| Check                                      | What it proves                                                                                                                                                            |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| migrations on an empty database            | The whole chain in `backend/database/postgres/migrations/` applies, every name is recorded, a second run changes nothing.                                                 |
| upgrade from the documented earlier schema | The schema after `040_agent_plan_one_shot.sql` receives fixture tickets and events, then the rest of the chain moves them (departments, outbox audiences).                |
| failing migration fails the run            | A migration that throws makes `migrate` fail, leaves no part of itself and keeps the earlier migrations.                                                                  |
| edited and unknown migrations are refused  | A changed applied migration and a database ahead of the code are refused.                                                                                                 |
| commit                                     | The statements of a transaction are visible after its commit.                                                                                                             |
| rollback                                   | A thrown error and a rejected statement each roll back the whole transaction; the database stays usable.                                                                  |
| parameter binding                          | Values are bound, never read as SQL: quotes, placeholders, an injection attempt, a `bigint` beyond 2^53, bytes, `null`, booleans, U+0000, missing and unknown parameters. |
| notifications                              | `pg_notify` reaches a listening session after a commit and from a direct send, in order, and never after a rollback.                                                      |

The documented earlier version of the upgrade check is
`UPGRADE_BASE_MIGRATION` in `scripts/postgres-integration/migration-checks.ts`.
When a later migration changes the tables of the fixtures, the check fails and
the fixtures are updated with that migration.

A broken migration anywhere in the chain fails the migration checks and with
them the command.

## Command, exit code and report

```text
pnpm run test:integration [--output <directory>]
```

| Exit code | Meaning                                                    |
| --------- | ---------------------------------------------------------- |
| 0         | Every check passed and the run was cleaned up.             |
| 1         | At least one check failed.                                 |
| 2         | Setup, wrong server version or cleanup failed; no verdict. |
| 3         | The run was interrupted by a signal; the cleanup ran.      |
| 64        | Wrong command line arguments.                              |

The report goes to `coverage/postgres-integration/` (ignored by Git), apart
from the unit coverage in `coverage/backend/`:

- `integration-report.json`: run identifier, times, the PostgreSQL version text
  the server reported, the required major version, the upgrade base migration,
  the number of migrations, the exit code, problems and every check with status,
  duration and detail.
- `integration-report.tsv`: the checks as a table.
- `postgres-server.log`: the log of the throwaway server.

## CI

`.github/workflows/postgres-integration.yml` runs on a push to `main`, installs
PostgreSQL 18 from the PostgreSQL apt repository, runs the command, writes the
checks into the job summary and uploads the report directory, also after a
failure. The job fails with the exit code of the command.
