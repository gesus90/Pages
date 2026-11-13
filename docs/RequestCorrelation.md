# Anfragen über Prozessgrenzen verfolgen

[Documentation index](README.md) ·
[Log files, retention and errors](#server-logging-page-67) · [Log level](#log-level)

`correlationId` ist die gemeinsame Kennung einer ausgelösten Arbeit. Sie steht
auf oberster Ebene der bestehenden strukturierten JSON-Logzeilen. `requestId`
bezeichnet dagegen genau eine HTTP-Anfrage und wird von Pages immer neu erzeugt;
die Antwort liefert sie weiterhin als `X-Request-ID`.

Interne HTTP-Aufrufe senden `X-Correlation-ID`. Pages übernimmt eine einzelne
Kennung aus 1 bis 128 ASCII-Zeichen: zuerst Buchstabe oder Ziffer, danach außerdem
Punkt, Unterstrich, Doppelpunkt und Bindestrich. Fehlende, mehrfache oder ungültige
Werte beginnen mit der neuen `requestId` eine eigene Korrelation. Die Antwort
enthält die gewählte Kennung in `X-Correlation-ID`. Diese Kennung gewährt keine
Rechte und ersetzt keine Authentifizierung. Sie darf keine Nutzdaten oder Secrets
enthalten.

Pages übergibt `PAGES_CORRELATION_ID` in den expliziten Umgebungen lokaler
CLI-Agenten, ihrer Worker-Units, Plan-Skripte und der ACP-MCP-Brücke. Ein Prozess,
der den Pages-Logger verwendet, übernimmt die validierte Umgebungskennung beim
Laden des Loggers. Andere Worker lesen dieselbe Variable für ihre eigene
Protokollierung. Der eigenständige MCP-Prozess sendet sie bei Agent-API-Aufrufen
und Asset-Uploads als `X-Correlation-ID` zurück. Externe Provider-APIs erhalten
diesen internen Header nicht.

Geschäftsoperationen und Jobs behalten die Korrelation ihres Auslösers; ohne
Auslöser erzeugen sie eine neue UUID. `withBackgroundDatabaseWork` behält die
Logkorrelation und entfernt das Abbruchsignal sowie das kurze Datenbankbudget
der auslösenden Anfrage. Ein expliziter Stop und der geordnete Server-Shutdown
bleiben wirksam. Der Planscheduler hält die Logfakten pro aktivem Lauf fest,
damit ein Poll oder ein anderer Lauf sie beim nächsten Schritt nicht ersetzt.
Nach einem Prozessneustart beginnt ein neu ausgelöster Lauf eine neue Korrelation;
`runId` verbindet ihn mit den vorhandenen Laufprotokollen. Das externe
Runner-Protokoll wird durch diesen HTTP-/Umgebungsvertrag nicht erweitert.

Zur Suche zuerst `X-Correlation-ID` aus der Antwort oder `correlationId` aus einer
bekannten Zeile ablesen. Dann die JSON-Dateien im `log/`-Verzeichnis neben der
jeweiligen Instanzkonfiguration und die Worker-Logs nach dieser Kennung filtern:

```sh
jq -c --arg id 'KENNUNG' 'select(.correlationId == $id)' /private/instance/log/*.jsonl
```

`time`, `component`, `event`, `pid` und `instanceId` zeigen Reihenfolge und
Prozessgrenzen. Unterschiedliche `requestId` bei gleicher `correlationId` sind
erwartet. `runId`, `jobId` und `attemptId` grenzen die Arbeit weiter ein. Schema,
Schweregrade, Meldungen, Metadaten, Fehlerdarstellung, Redaktion und Dateirotation
behalten ihr bestehendes Format.

### Server logging (PAGE-67)

Pages uses Pino **10.4.0** behind `backend/logging/Logger.ts`. The six severities
are `trace`, `debug`, `info`, `warn`, `error` and `fatal`. Every severity from
`info` upward enters the daily log without sampling; `PAGES_LOG_LEVEL` selects
another minimum (see [Log level](#log-level)). Existing
server diagnostics also pass through this interface; their operator-console
mirror is sanitized centrally and follows the same minimum.
There is no global console interception. Third-party processes retain their
own logging boundaries.

Logs are UTF-8 JSON Lines: one JSON object followed by LF, with escaped newlines
in messages/stacks. Example: `~/.pages/log/pages-2026-10-17.jsonl`. `log/` is
always next to the selected configuration: `--config /srv/team/config.toml`
uses `/srv/team/log/`, regardless of the database path or working directory.
The directory uses mode 0700 and files 0600 on POSIX; symlinks at the managed
directory/file are refused. Logs are outside the public asset directory and
are never offered through an HTTP log/download endpoint or a client bundle.

Each record carries `schemaVersion: 1`, UTC `time` with millisecond precision
(`...Z`), `severity`, stable `event`, `component`, `message`, `pid` and a random
process `instanceId`. AsyncLocalStorage carries request/correlation, run, job
and attempt IDs when those boundaries apply. HTTP responses expose the server's
generated `X-Request-ID`; inbound IDs are not trusted. Errors have an `errorId`,
type, safe message, code, stackframes and a bounded cause chain. Repeated reports
of the same error object reference its original `errorId` instead of repeating
the whole cause. Recovered exceptions are recorded before domain translation.

**Calendar and rotation:** file dates and retention use the server's local IANA
zone, fixed for the process and announced as `timeZone` in `logging.initialized`.
There is currently no separate instance-zone setting; personal/browser timezones
do not apply. Every event is assigned its capture date before queuing, including
23:59:00 through 23:59:59.999. Async writes after midnight keep that assignment.
The next event opens the new date without restart; no empty daily files or
heartbeat entries are manufactured. Local calendar arithmetic and the next local
midnight handle 23/25-hour DST days without subtracting 24-hour intervals.
Changing the server zone while running is unsupported; restart after a zone change.

Files are opened for append. A restart on the same date preserves earlier
records. On open, a valid final JSON object missing LF gets its LF; only an
incomplete suffix after the last valid newline is truncated. No complete earlier
record is rewritten. One ordered asynchronous writer prevents interleaved lines.
Each drained batch and orderly shutdown perform `datasync`.

**Retention:** only a current, active system administrator in admin mode can
read or change **Settings → System → Server logging / Einstellungen → System →
Serverlogging**. Loader, action and service check authorization. The persisted
`logRetentionDays` accepts integers **0–365**, defaults to **30** when absent and
takes effect immediately after a successful configuration write. Invalid input
leaves the file and running policy unchanged; other TOML keys are preserved.
The explanatory value is explicitly labelled **Currently saved / Aktuell gespeichert**,
including after validation errors; it describes the persisted value, not an invalid
unsaved input. **0 = Unlimited / Unbegrenzt**, with no age deletion. For N > 0,
retain today and the preceding N−1 calendar dates; N=1 retains today, N=30 retains 30 dates in all.
Cleanup uses filename dates, never mtime, and runs at startup, after local midnight
and after a saved change. Shortening retention immediately makes older files
eligible for deletion. No size/emergency retention overrides this setting.

Cleanup serializes with rotation and protects open/queued dates. Only regular
files named exactly `pages-YYYY-MM-DD.jsonl` with real dates older than the cutoff
are removed. Future/invalid dates, symlinks, directories and foreign filenames
are left alone. There is no recursion or traversal of symlink targets, configuration,
databases, credentials or run artifacts. Cleanup counters and failures are logged;
failed files remain eligible for subsequent startup/day/change cleanups.

**Privacy and limits:** log metadata accepts at most 32 allowlisted primitive
fields (IDs, operation/route kinds, status, duration and counters), strings at most
256 characters. Objects, bodies, headers, SQL parameters, prompts, chat/wiki/ticket
texts, attachments and provider payloads are omitted. HTTP paths keep known static
segments and replace opaque segments with `:id`; all queries are omitted. SQL is
represented by operation plus a SHA-256-derived identifier, never its text or
bound values. Ordinary statements do not produce individual events. Outside the
successful polling exception below, every attempted statement contributes to
`databaseQueries`, `databaseTotalMs`, `databaseSlowestMs`,
`databaseSlowestStatementId` and `databaseSlowestOperation` in the enclosing HTTP
completion/disconnect, scheduled job, Pica job, agent step, connection initialization,
migration or transaction completion event. Durations are milliseconds rounded to
three decimal places; counts include failures and transaction control statements.
Counts measure database execution calls; a multi-statement migration/setup batch
counts as one call, without parsing or retaining its SQL text.
`databaseTransactionsCommitted` / `databaseTransactionsRolledBack` preserve every
transaction outcome. Successful nested transactions are included in their parent
completion instead of emitting another success event; standalone transactions and
all rollbacks retain individual events. Nested scopes also contribute once to each
parent scope; do not sum nested and parent summaries together. Statements outside
an enclosing operation contribute to one bounded `database.operations.completed` trace aggregate every
five seconds while there is work, and once at shutdown. No empty aggregate is emitted.
Errors always emit individual events. Statements taking **at least 250 ms** also
emit `database.statement.slow` warnings: this highlights a material portion of an
interactive request without flooding logs with ordinary local reads. Optional
`PAGES_SLOW_QUERY_MS` overrides the shared statement/slow-poll threshold (finite nonnegative milliseconds;
empty/unset/invalid values use 250; 0 diagnoses every statement individually).
Production loader/action starts and successful completions are likewise counted
in their HTTP completion/disconnect: `routeLoaders`, `routeActions`,
`routeHandlersCompleted`, `routeHandlersFailed`, `routeHandlerTotalMs`,
`routeHandlerSlowestMs` and the static `routeHandlerSlowest` route ID. Every failed
handler and HTTP control response remains an individual event, except successful
polling control responses described below. Handlers without
an open HTTP aggregate, including completions after disconnect, retain individual
lifecycle events. Route duration sums can overlap when handlers run concurrently.
Closed request scopes do not absorb later background work. This is deterministic
aggregation, not sampling or a severity filter. Cache operations always
emit safe trace metadata; the old `PAGES_CACHE_DEBUG` minimum no longer filters them.

**Successful polling exception:** `backend/logging/PollingLogPolicy.ts` centrally
lists exactly five read-only status routes. Only GET/HEAD requests qualify;
React Router's equivalent `.data` URLs and a trailing slash use the same policy.

| Route | Caller / purpose |
| --- | --- |
| `/account-version` | Authorization refresh every 5 seconds per browser tab and on focus |
| `/health` | Reverse-proxy / uptime heartbeat |
| `/agent-api/resources` | ACP occupancy diagnostics every 5 seconds |
| `/agent-api/plan-runs` | Active/paused plan status every second |
| `/settings-api/agents/:connectionId/login` | Pending CLI login status every 2 seconds |

For these routes, HTTP 2xx/3xx (including 304) below **250 ms** produce no
`http.request.started/completed`, successful `route.loader.*`/control-response
events or database/handler summary. Counts are still isolated and discarded at
completion, so they cannot leak into the five-second unscoped database aggregate.
This is an intentional completeness exception: polling produces noise without
operational value. It is deterministic by route, method, status and elapsed time;
there is no random sampling or severity filter. Their request ID header remains.
No start event is emitted even if a poll later fails: errors/status >=400, slow
responses (duration **at least** the shared threshold), disconnects, exceptions,
slow/failed statements and permission denials remain visible. Failed/slow poll
completions include all request database/handler totals; slow polls and 4xx use
warn, 5xx use error. The shared default 250 ms marks a material interactive delay;
`PAGES_SLOW_QUERY_MS` changes it for both statements and polls, including 0 for
diagnosis. Domain/security events are never suppressed by this policy.
Service initialization and maintenance triggered by a first cold request also
retain their own operational events, even when they inherit that poll's request ID.

An `/account-version` success additionally emits **`account.authorization.changed`**
exactly when the delivered existing fingerprint differs from that account's last
successfully delivered version. It contains only `userId` and the usual event
time/correlation facts, never either fingerprint or role contents. The first
delivery after startup is a silent baseline. One in-memory map retains at most
4096 accounts, evicting the least recently polled account; a subsequent first poll
after eviction is also a baseline. Failed/disconnected requests do not advance
the baseline. There is no persistence or synchronization between processes, and
changes that occur and revert between polls cannot be observed by this mechanism.

The route/client inventory also checked interval-driven mixed interfaces:
`/chat-api` POST mixes journal/content reads and mutations, and project Discord
reads may retrieve external channel data. They retain ordinary logging. Search,
draft autosaves, full-page revalidation and ACP SSE streams also retain their
ordinary operational boundaries; they are not pure status/heartbeat routes.

Central redaction masks registered setup capabilities, secret-valued environment
variables, credential assignments, Authorization/Bearer/Basic credentials, common
provider-token forms, private keys, URL credentials and query values. Free-form
error messages are deliberately replaced with a safe description because providers
and database drivers can echo full user content there. Only stackframes survive the stack's
message line; up to five cause objects and 24 frames/1200 stack characters per
cause are retained. Circular/deep/hostile errors get explicit safe markers. Messages
are limited to 4000 characters, complete serialized records to 32 KiB; shortened
text has `[TRUNCATED]` and shortened metadata/records have `truncated: true`.
Exact-value matching registers at most 256 secrets of at least four characters;
environment-value matching also starts at four characters. Named secret fields are
omitted regardless of length, and credential-assignment/header patterns mask short
values too. Malformed event serialization writes a safe marker to stderr and the
daily file and increments the same administrator-visible persistent loss counter.

**Operational boundaries:** the queue holds at most 2048 entries / 8 MiB. Filesystem
writes are asynchronous and ordered; overflow records go to sanitized stderr,
increment a persistent process loss counter and keep administrator health degraded.
Disk/permission failures retain the bounded accepted queue, report a safe OS code
through stderr and retry after five seconds. Once storage works, queued dates
are drained; later events resume normal writing. If no queued event remains, the
next event probes storage. Settings shows a warning and counts for write failures
or lost records. stderr uses a synchronous last-resort write, which can block under
overload; this avoids an unbounded secondary stream buffer. No recursive logger
calls or automatic removal of younger files attempt to hide an outage. Accepted
records are also mirrored once to sanitized stderr while storage is unavailable;
after recovery their original dates are preserved when the queue reaches disk.

Exactly **one file writer per log directory** is supported. On Linux this requires
the `flock` utility from util-linux in the server's PATH and a local filesystem.
A short, shell-free `flock --exclusive --nonblock` invocation (two-second utility
timeout) locks a duplicated descriptor; the server keeps the same open file
description until shutdown.
The kernel releases ownership on descriptor closure, including SIGKILL. See the
[Linux lock semantics](https://man7.org/linux/man-pages/man2/flock.2.html) and
[Node descriptor sharing](https://nodejs.org/api/child_process.html#optionsstdio).
The private, persistent `.writer.lock` inode is never unlinked or replaced. Its
bounded JSON record contains schema version 2, PID, random instance ID, Linux boot
ID/process start ticks and an orderly-release marker. A PID alone never grants or
denies a version-2 lock: kernel ownership prevents PID-reuse and concurrent-recovery
races. An unheld stale, empty or truncated record is replaced automatically after
acquisition, with `logging.ownership.recovered` in the daily log. No manual deletion
is required. An orderly restart appends without a recovery warning.

If another live writer holds the lock, Pages **still starts** with `LOG_WRITER_BUSY`,
sanitized stderr output, the bounded retry queue and a visible system-admin warning.
It cannot append, rotate or clean the other writer's files. It retries every five
seconds and resumes after release. Missing `flock`, unsupported platforms, invalid
lock files and ownership I/O failures use the same nonfatal degraded path. No log
ownership failure is a fatal startup condition. A live legacy PID-only record is
treated conservatively as busy; a dead legacy PID is recovered. Concurrent mixed
versions and clustering/network filesystem lock guarantees remain unsupported.
Do not remove the lock file while any writer is running.

SIGINT/SIGTERM stop producers, run service cleanup and flush/close the writer,
with a 30-second shutdown deadline. Uncaught exceptions/rejections and fatal startup
errors use the same failure-exit path; before a usable configuration/module graph,
sanitized bootstrap events go to stderr and are copied into the file when possible.
SIGKILL, power loss, an unavailable stderr, failure before capture, an overflowing
queue or permanently full disk cannot guarantee every event reaches disk.

**Event coverage:** startup/configuration, migrations and service initialization;
HTTP start/end/status/duration/disconnect and framework server errors (with the successful
polling exception above); production loader/action
lifecycle aggregates and individual failures/control responses; login/logout and
permission denials and delivered account-authorization changes; committed wiki/ticket/milestone events; database statement
aggregates, slow statements, transactions and errors; cache operations; GitHub, wiki,
Discord and model-catalog jobs; provider/integration responses;
Pages-owned plan bridge requests; plan/run/step, CLI/ACP session, tool, cancellation,
closeout and persistence diagnostics, including Pica jobs. Browser telemetry,
third-party internals, full CLI stdout, prompts and content chunks are intentionally
excluded. Development includes request/error and database/service instrumentation;
the production build additionally wraps every registered loader/action. Expected
ENOENT/ENOTDIR during static-file matching, optional artifact/existence probes and
directory creation or cleanup of unused upload stores, plus handled EEXIST/process-disappearance races, are ordinary
control flow and do not emit `application.exception.caught`. Unexpected I/O and
required-file errors still do. Activity,
audit and persisted session/run histories retain their separate business purposes.

## Log level

`PAGES_LOG_LEVEL` selects `trace`, `debug`, `info`, `warn`, `error` or `fatal`.
Unset or invalid values use `info`. This applies to the process logger and
operator-console mirror; restart after changing the process environment.
Source: [Logger.ts](../backend/logging/Logger.ts). A level below `info` is useful
for the trace aggregates described above; it does not alter retention.
