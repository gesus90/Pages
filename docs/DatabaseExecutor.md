# Database executor

Pages uses PostgreSQL through `databaseUrl` after setup. `Database` is the facade
for repositories, with `execute`, `query`, `transaction` and `readTransaction`.
`PostgresExecutor` uses a pool of ten connections, one reserved for the serialized
writer and nine for reads. Bounded queues and deadlines reject work that has not
started; a write with an unknown outcome is never retried automatically. A read
transaction keeps one snapshot. The server does not start a database worker.

The setup wizard accepts a PostgreSQL URL and checks connectivity and an empty
public schema without migrating it. It initializes migrations and the first
administrator in a database transaction. A private setup intent permits recovery
if configuration persistence is interrupted after that transaction; it binds the
attempt to the URL, submitted setup values and the committed session. The intent
is removed after successful activation. Invalid or foreign intent data is refused.
Configuration and the database are not one atomic resource. See
[PostgresMigration.md](./PostgresMigration.md) for backup and offline transfer.

`/health` reports database readiness; `/health/live` reports only HTTP liveness.
A completed configuration without `databaseUrl` is rejected. The remaining
`databasePath` identifies the application data directory and does not select a
database backend. Historical DuckDB files must be handled with a previous
release or the offline transfer tool; they are not opened by the Pages server.

## Service processes and PostgreSQL writer ownership

The API, standalone plan engine, integration service and native owner processes
share one PostgreSQL advisory writer lock around each writer job. A transaction
keeps that lock from its first statement through commit/rollback and effects.
The existing per-process writer lanes still bound admission; waiting for another
process also observes the writer budget and request cancellation. A connection
whose lock cleanup is uncertain is discarded. Reader snapshots remain on the
reader pool. Transaction preconditions read after writer admission and do not
reuse values cached earlier in an HTTP request.
