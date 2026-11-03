# Database executor

Pages keeps DuckDB as its only database, but since PAGE-197 the server no
longer holds a DuckDB handle itself. A local worker process owns the
database file; the server talks to it over the Node IPC channel. The
`Database` class (`backend/database/Database.ts`) stays the facade every
repository uses, with the same `execute`, `query` and `transaction`
methods, plus `readTransaction` for consistent read-only snapshots.

## Owner model

- **One worker process, one instance.** `DatabaseWorkerClient`
  (`backend/database/executor/DatabaseWorkerClient.ts`) forks
  `DatabaseWorker.ts` once when the database opens. The worker opens the
  `DuckDBInstance`, one **writer** connection and a pool of **reader**
  connections of that same instance. No native handle ever leaves the
  worker; only statements, bound values, rows and error texts cross the
  boundary (`DatabaseWorkerProtocol.ts`).
- **Why a child process and not `worker_threads`.** A native crash in
  DuckDB ends only the worker, not the HTTP server. The worker has its own
  libuv thread pool, so long DuckDB calls never take the threads the server
  needs for files, crypto (login) and DNS. Converting large results happens
  in the worker, not on the server's event loop. The V8 serializer of
  `child_process` (`serialization: "advanced"`) keeps `bigint`, `Buffer`
  and `null` exact.
- **Never two writers.** A new worker is forked only after the previous one
  exited, also after a failed or timed-out open (the hung worker is killed
  first). DuckDB's own file lock is a second barrier.
- **Builds.** In development and tests Node runs the TypeScript source
  directly (type stripping; the worker imports nothing from Pages except
  types). `pnpm build` ships it as `build/server/database-worker.mjs`
  (`pagesDatabaseWorker` in `vite.config.ts`), next to `index.js`, and the
  production server forks that file. It resolves `@duckdb/node-api` from
  the installed `node_modules`, like the server bundle.

## Statement routing

| Call                                                                                    | Runs on             | Notes                                                                                                                                                             |
| --------------------------------------------------------------------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `execute()`                                                                             | writer              | One writer job.                                                                                                                                                   |
| `query()` of a statement `statementKind` calls `write` (INSERT … RETURNING, nextval, …) | writer              | One writer job.                                                                                                                                                   |
| `query()` of a SELECT                                                                   | a reader            | DuckDB parses it in the worker; anything but exactly one `SELECT` is refused there and rerun on the writer (`reroutedReads`).                                     |
| `transaction(work)`                                                                     | writer              | The whole callback is one writer job: every statement, the lazy `BEGIN`, `COMMIT`/`ROLLBACK` and the file effects. Mixed and read-then-write work always uses it. |
| `readTransaction(work)`                                                                 | one reserved reader | `BEGIN` on the first read, all reads on one snapshot, `COMMIT` at the end; `execute` and writing queries are refused.                                             |

Readers always see the last committed state: never an uncommitted change of
the writer, and never a state older than a read that already finished, since
all connections belong to one instance. A request that checks rights and
then reads data with plain queries therefore never sees rights older than
its data. Where rights and data must come from one snapshot, the services
use `readTransaction` (authorization snapshot, project read scope, assignee
filter, MCP project names, project templates, agent profile/workspace/remote
lists, plan-run progress, the polled recovery view of a plan run). A read issued while a write is still running sees the state
before it; once the write's promise resolved, its commit is visible to
every later read (read-after-write).

Writes that only keep bookkeeping current do not make a request wait: the
session's `last_used_at` (minute precision, no authorization input) is sent
at most once a minute per session, without awaiting it, and never twice
while one is still queued (`SessionService.touch`). Before PAGE-197 every
authenticated request awaited this UPDATE, so every page waited behind any
long write.

## Queues, budgets and limits

All numbers live in `DATABASE_EXECUTOR_LIMITS`
(`backend/database/executor/DatabaseExecutorLimits.ts`).

| Limit                                           | Value                               | Reason                                                                            |
| ----------------------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------- |
| Reader connections                              | 2                                   | Writer plus two readers occupy three of the worker's four libuv threads.          |
| DuckDB `memory_limit` of the worker             | 6 GB                                | See below; DuckDB's default is 80 % of the RAM.                                   |
| Reads in flight to the worker                   | 4                                   | More wait in the server's reader lane.                                            |
| Waiting reads                                   | 512                                 | Then new reads are refused.                                                       |
| Waiting writer jobs                             | 256                                 | Then new writes are refused.                                                      |
| … of recurring background work                  | 32                                  | GitHub synchronization cannot fill the writer queue.                              |
| Queue budget of a read                          | 10 s                                | Refused unstarted afterwards.                                                     |
| Queue budget of a writer job of an HTTP request | 25 s                                | The request answers 503 instead of loading without end.                           |
| Queue budget of a writer job outside requests   | 10 min                              | Agent persistence waits for a slow commit rather than losing progress.            |
| Result / bound values of one statement          | 64 MiB                              | Larger results must be paged by the repository.                                   |
| Worker open / close                             | 120 s each                          | WAL replay and the shutdown checkpoint can take long.                             |
| Jobs finishing before the close                 | 15 s                                | Apart from `COMMIT`, a transaction spent at most 0.55 s in DuckDB in the logs.    |
| Worker exit after close                         | 5 s                                 | Then the worker is killed; it ignores stop signals and leaves them to the server. |
| Restarts after unexpected exits                 | 3 within 10 min, delay 1 s doubling | Then the executor stays `failed`.                                                 |
| `/health` database probe                        | 3 s                                 | Unchanged contract.                                                               |

The worker opens the database file with `memory_limit` set to
`DATABASE_EXECUTOR_LIMITS.memoryLimit` (PAGE-202), also when it opens the file
again after a WAL replay; the in-memory instance of that replay keeps DuckDB's
default. Without the limit DuckDB may use 80 % of the RAM: during the OOM of
2026-11-03 the worker held about 10 GB of the 22 GB server and the swap was
full. 6 GB leaves the server, the agent workers and the system enough room on
that machine. It is a start value, not a setting: it is adjusted in the code
after the worker's memory has been measured under agent load. A statement that
needs more fails with DuckDB's out-of-memory error like any other DuckDB error
of that statement; the worker, its connections and both lanes go on.

Both lanes start jobs strictly first-in-first-out, whatever their class
(`request`, `background`, `recurring`, see `DatabaseWorkContext.ts`), so no
class can starve another; recurring work only has fewer waiting places.
`RequestLogging` marks HTTP requests as `request` work with the request's
abort signal, so a job of a request whose client went away is refused
before it starts.

Async context outlives a request, so everything a request starts inherits
that signal and that budget. Work that must go on after the request therefore
leaves it explicitly with `withBackgroundDatabaseWork` (PAGE-199): GitHub
publications, the plan engine with every node it dispatches, the delivery of
session instructions, Pica jobs and the ACP resource scheduler. This changes
only the database budget and the abort: actor and rights stay as the caller
passes them on, and the work still ends through its own abort controllers, the
explicit stop of a person or the server stop. See [PAGE-199](./PAGE-199.md).

## Failure semantics

| Error                                                                | Meaning                                                                                                                                                                          | Repeat?                                                                     |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `DatabaseOverloadedError` (`overloaded`, `queue_timeout`, `aborted`) | Queue full, budget exceeded or caller gone. The job never started.                                                                                                               | Safe.                                                                       |
| `DatabaseUnavailableError`                                           | Worker starting, restarting, failed or closing. Nothing was sent.                                                                                                                | Safe, after `Retry-After`.                                                  |
| `DatabaseOutcomeUnknownError`                                        | The worker ended while it held a write. A failure inside an open transaction means the transaction was lost (DuckDB never committed it); during `COMMIT` the outcome is unknown. | Never automatically. Callers reconcile through revisions and operation IDs. |
| DuckDB errors                                                        | Passed on with DuckDB's message (constraint checks such as `isUniqueViolationOn` keep working).                                                                                  | As before.                                                                  |

HTTP answers every executor error with **503** and `Retry-After`. A started
job is never cancelled to meet a budget, and nothing is retried
automatically. When the worker ends during `COMMIT`, neither the commit nor
the rollback file effects run, and `database.transaction.outcome_unknown` is
logged. A failed file cleanup after a confirmed commit is only logged; the
mutation stays committed. `database has been invalidated` still ends the
whole process (`database_invalidated`), as before, so the service manager
restarts it and startup recovery runs.

A server stop runs in a neutral database context (a stop started from an
unhandled rejection would otherwise inherit its closed request), and its steps
are isolated: a failing or stuck step is logged under its name
(`server.shutdown.step_failed`, `server.shutdown.step_timeout`), and the later
steps and the close of the database still run. The event
`server.shutdown.database_close` and the final events name the outcome of the
close (`closed`, `failed`, `timed_out`, `closing`, `not_attempted`); only a
confirmed close counts as `closed`. The budgets are in
[PAGE-199](./PAGE-199.md#time-budgets).

`close()` first refuses new jobs and lets the accepted ones finish, because the
worker refuses every statement once it closes, also the `COMMIT` or `ROLLBACK`
of a transaction still running. A job past the limit is logged
(`database.executor.drain_incomplete`), and a `COMMIT` already sent still
finishes. The worker then waits for the statements it received, rolls back what
no statement can end any more (the writer's transaction and open read sessions,
which DuckDB would otherwise answer with a refused `CHECKPOINT`), checkpoints
with its live writer connection (the DuckDB 1.5.5 workaround of
`Database.close()`) and closes every connection. If the server disappears, the
worker does the same and exits. WAL
replay through an attached in-memory database is unchanged and now happens
in the worker (`walReplayed` in `database.worker.ready`).

The GitHub synchronization (`GitHubSyncScheduler`) runs as `recurring` work
and is single-flight: a tick during a running round is skipped and logged
(`job.github_sync.skipped`), and `stop()` waits at most 10 s for the round.
A failing project is retried after 1 minute, doubling up to 60 minutes
(`GitHubSyncBackoff`, stored in `next_sync_at`); 401/403 stay visible as
`job.github_sync.project_failed` with `reason: github_auth`.

## Health

- `/health` keeps its contract (`ok` / `setup` / `unavailable`, 503 on
  `unavailable`, 3 s budget). Its `SELECT 1` runs on a reader, so a long
  write no longer makes it time out, and it is `unavailable` whenever the
  worker is not `ready`. The body names the worker state in `database`.
- `/health/live` proves only that the HTTP process answers. It never touches
  the database and is no statement about database readiness.

## Observability

- `database.statement.slow`: `durationMs` is the execution inside DuckDB,
  measured in the worker. `workerWaitMs` (wait for a free reader) and
  `ipcMs` (serialization and transfer) are separate. For `COMMIT` and
  `CHECKPOINT`, `walBytesBefore`/`walBytesAfter` and `checkpointed` show
  whether DuckDB checkpointed during the statement.
- `database.queue.slow`: a job waited longer than the slow threshold for its
  turn (`lane`, `workClass`, `queueMs`, `queued`).
- Request and job completion events carry `databaseTotalMs` (execution),
  `databaseQueueMs` and `databaseIpcMs` next to the request's own duration.
- `database.worker.ready`, `database.worker.exited`,
  `database.worker.restart_failed`, `database.worker.failed` trace the
  lifecycle. `Database.executorStatus()` returns queue depths, running jobs,
  refused jobs per reason, rerouted reads and the worker state; it holds no
  SQL and no values.
- `database.executor.status` writes those counters to the log every 60 s while
  the executor does anything, and once more when it closes. A failure of that
  last report is logged and never keeps the database from closing.
- `database.wal.growth` names, per kind of work (`origin`: a route pattern, an
  Agent API operation of the catalog or a fixed name such as `plan_run`), how
  much the write-ahead log grew since the last report and how many statements
  checkpointed. At most the ten largest origins of an interval are reported. The
  bytes are a lower bound: a statement that also checkpointed adds none.
- Errors of the executor carry `failure` and `notStarted` in the structured
  `error` of the log; `DatabaseOverloadedError` alone says little, because its
  reason may be `aborted`.
- After the server is gone, the worker writes one JSON line
  (`database.worker.closed`) to stderr with its duration and whether the
  checkpoint succeeded.

## Known limits

- The executor removes the server-side head-of-line blocking. It does not
  make DuckDB itself faster: a slow `COMMIT` still holds the single writer,
  and writes queue behind it. A checkpoint that DuckDB runs during `COMMIT`
  (automatic once the WAL exceeds `checkpoint_threshold`, 16 MiB by default)
  or a stalled disk can still slow reads that need the same data pages.
  The WAL fields of `database.statement.slow` tell whether a slow commit
  checkpointed. The checkpoint threshold stays untouched until an isolated
  measurement justifies a change, because more WAL means a longer replay.
- A crash of the worker loses the uncommitted transaction (as a process
  crash did before) and makes the outcome of an in-flight `COMMIT` unknown.

## Rollout and rollback

Rollout is a normal deploy of the built `build/` directory: the server forks
`build/server/database-worker.mjs` itself, and no configuration, migration
or data change is involved. Watch `database.worker.*`, `database.queue.slow`
and the WAL fields of `database.statement.slow` after the deploy. To roll
back, deploy the previous build. The database file format is unchanged, and
both versions checkpoint on a regular stop.
