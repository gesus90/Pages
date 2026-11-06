# GitHub and FCM service

`pages-integrations.mjs` runs the GitHub queue and the FCM push outbox in a separate
Node process. It uses the same built server artifact and PostgreSQL database as
Pages. It starts no web listener, mobile gateway, agent execution engine, runner
recovery, catalog refresh, or tool provisioning. Its authorization objects read
the same current account, project, plan, workspace, model, ticket and attachment
permissions as the API. Constructing those objects starts no external session.

Discord extraction is **DEFERRED_BY_USER** (PAGE-225 scope correction,
2026-11-05). Its existing implementation and server behavior are unchanged.
The mode below applies only to GitHub and FCM; it does not disable Discord.

## Mode and operation

The persisted `config.toml` key is:

```toml
integrationsMode = "server"
```

Omitting it keeps the legacy location inside the API server. Only `"server"`
and `"separate"` are accepted. A mode change requires a process restart; this is
not a live toggle. Both processes must use the same instance configuration,
database and instance key. Existing settings writes preserve the key.

To prepare a separate installation, first install the matching application
build and let the API server apply the numbered PostgreSQL migrations. The
integration service does not migrate, finish setup, or create a configuration.
After an explicitly authorized maintenance stop of the old consumer, set:

```toml
integrationsMode = "separate"
```

Restart the API server with that configuration, then start:

```sh
node pages-integrations.mjs --config /absolute/instance/config.toml
```

Starting the entrypoint without explicit separate mode refuses startup. Returning
to server mode uses the reverse maintenance sequence: stop the separate consumer,
change the shared configuration, restart Pages. No deployment or switch is
performed by adding this source package.

`deploy/integrations/pages-integrations@.service` is an unactivated template.
Adjust the Node/install/configuration paths and dedicated service account to the
installation. The data directory must be `/var/lib/pages/%i` or its narrowly
configured replacement. `MemoryMax=256M` is the 256 MiB cgroup budget; the V8 heap
limit leaves headroom for buffers, native libraries and connections. Restart is
always enabled. Do not grant additional writable host directories just to make
an incorrect path work. Configuration and FCM key files must be readable only by
the service identity, and the instance data/key directory must be shared with
Pages under that identity. ProtectHome intentionally excludes home directories.

## Ownership, API behavior and outage

A dedicated PostgreSQL session advisory lock elects exactly one GitHub/FCM
processor per database, across both modes. It is not a time lease: a slow live
consumer is not replaced just because a deadline elapsed. A second separate
process refuses startup and can retry under systemd. A non-owning API process
continues serving requests and producing jobs. In server mode a non-owning
replica needs a restart to compete for ownership after the owner dies.
A lost ownership connection terminates the owning process immediately so it
cannot knowingly continue sending without its lock. Database/network failure
cannot provide a distributed exactly-once guarantee for an external side effect.
The operating mode change therefore requires stopping the former consumer;
merely editing one process's copy of the file is not a supported handover.

The service retains ownership throughout shutdown, including bounded FCM drain,
until process exit. PostgreSQL then releases the lock. GitHub jobs in flight
are recovered by the next elected owner; FCM resumes after its existing
120-second delivery lock expires. Polling picks up newly committed jobs without
any IPC dependency on the API server. FCM callbacks in the API process are gated
by ownership, as are its periodic dispatch and direct `kick` calls. Registration,
replay reads and recording of run events stay in the server (and existing run
producer paths); FCM key availability continues to be checked there for the
existing capability/registration contract. Keep the same protected FCM settings
available to both processes.

Every GitHub operation that contacts GitHub uses the durable job queue in
production, including periodic synchronization, committed ticket publication,
manual synchronization, connection checks, import/link and conflict resolution.
Purely local listing, assignment and dismissal stay local. Request-triggered
operations preserve their existing result shapes and known domain errors.
Results contain only counters, booleans or a task identifier; task responses are
reread with current API access checks. Waiting is bounded to 30 seconds. If the
consumer is unavailable, that request reports pending processing instead of
holding an HTTP connection forever; the stored job is not cancelled or lost.
Other UI/API requests keep working. Do not interpret a timeout as cancellation
or blindly repeat a non-idempotent manual operation.

In separate mode, committed ticket updates return once their publication intent
is stored. Default server mode retains the publication completion wait (bounded
like other queued calls), while the existing best-effort mutation boundary remains. The elected worker serializes these jobs with
manual and periodic work. A later update gets a separate intent, so it cannot be
merged into an already-running job and lost. Scheduled ticks share one active
job and retain the existing per-project schedule/backoff logic. Known access or
validation errors terminate a job; other reconcilable failures get at most six
attempts with persisted exponential delays. Job status and sanitized replies
remain in `integration_github_jobs`; completed/failed replies are retained seven
days. No raw provider body, token, exception message or account snapshot is stored
in that queue. No job-status public API is introduced.

## Recovery and idempotency boundaries

FCM keeps the existing event/device deduplication, encrypted tokens, expiry,
retry policy and notification identifiers. Claims now use `FOR UPDATE SKIP LOCKED`.
A crash after FCM accepts a send but before Pages records completion may repeat a
provider request; the existing notification identity is preserved. This package
does not claim provider-level exactly-once FCM delivery.

GitHub updates reconcile against current remote and local state. For an unlinked
task, `integration_github_creations` journals the create intent before sending.
The issue carries a stable opaque HTML comment. On recovery the worker first
uses a confirmed issue number, or finds the marker in the repository issue list,
and persists the recovered acknowledgement before linking the task. The marker
is retained through later updates and excluded from synchronized content hashes
and imported descriptions. If a previous create was attempted but neither a
confirmed number nor a remote marker can be found, no second create is sent.
The intent stays available for operator reconciliation. Inspect the remote
repository and the creation record before any authorized repair; deleting that
record without establishing the remote outcome can create a duplicate. A crash
between journaling and actually sending is intentionally indistinguishable from
a lost acknowledgement. No hidden timeout waives that uncertainty.

An interrupted external-issue import can have created a local task before storing
its link. Such a running job becomes `uncertain` on ownership recovery, rather
than creating another task. Inspect its command, local task/link and external
issue import record before repair. Other retried manual operations can report an
existing validation outcome after their effect committed; this is not proof of
failure of the original effect. The queue preserves work and evidence, but does
not invent a distributed transaction with GitHub.

The pre-existing producer boundaries remain: ticket publication begins after the
local mutation commits, and mobile events are recorded by the existing observer.
A producer crash in the interval before it stores an intent/event is outside
outbox recovery. Moving consumers does not make that interval atomic. Periodic
GitHub reconciliation can repair eligible task state; it is not an assertion that
every event was recorded. Import-generated in-process notifications are likewise
not a new cross-process event bus; Discord extraction is deferred.

## Verification status

This source package is an **unverified checkpoint** for parent review. No live
service is switched. The four isolated runtime criteria (separate delivery and
server exclusion, hard-kill recovery, UI/API independence, default compatibility)
remain UNVERIFIED until the parent provides and reviews permitted synthetic
execution evidence. Discord runtime proof is deferred by the user. The central
configured/affected QA bundle remains mandatory after PAGE-227.
