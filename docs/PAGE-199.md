# PAGE-199: Background work, database refusals and the server stop

Why this exists: on 2026-11-02 the server ended five times with exit code 1. A
client gave up after 5 s while its write was still committing. The GitHub
publication started afterwards inherited the closed request, every database job
of it was refused, the refusal in its error path became an unhandled rejection,
and the stop that followed inherited the same closed request, so it never reached
`database.close()`. The analysis is in PAGE-198.

This document records what the code now guarantees and what it deliberately does
not. It says nothing about a deployment or about behaviour in production.

## Background work leaves the request

`withBackgroundDatabaseWork` (`backend/database/executor/DatabaseWorkContext.ts`)
runs work as `background`: no request signal, the writer budget of 10 minutes.
The queues stay bounded. Rights are not touched: the actor is still passed on
explicitly and every service still checks it. An explicit stop and the server stop
work through the abort controllers of the work, not through this context.

| Work                                                                | Where it leaves the request                                                              |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| GitHub publication                                                  | `TaskGitHubPublisher.publish`                                                            |
| Plan runs, with every node they dispatch                            | `AgentPlanRunEngine.pump`, and the part of `launch` after the run committed              |
| Instruction delivery                                                | `AgentSessionInbox.drainDetached`                                                        |
| Pica jobs and their steers                                          | `ChatRequestRegistry.start`, `PicaAcpSteering.accept`                                    |
| ACP admission and leases                                            | `AcpResourceScheduler.wake`, `persist`                                                   |
| Service start and all schedulers it arms                            | `getApplicationServices`, `activateApplicationServices`                                  |
| Discord notifications, mobile notifications and the mobile listener | their subscriber, recorder, dispatcher and `PicaMobileGateway.switchTo`                  |
| Remote reconnect series, connection test, CLI login, stop deadline  | `RemoteSession`, `RemoteConnectionService`, `AgentCliLoginService`, `RunnerCancellation` |

The rest of a request stays `request` work on purpose: a job of a client that
left is refused before it starts, and the request answers 503 after 25 s.

## Refused writes in error paths

`TaskGitHubPublisher.publish` and the instruction delivery no longer reject.

- A failed publication logs `task.github_publish.failed`. If storing that failure
  on the ticket fails too, it logs `task.github_publish.failure_not_recorded`. The
  ticket change had already committed before the publication started and stays.
  `github_last_error` can then be missing; nothing repeats the publication.
- An instruction that could not be read or claimed stays `queued`, keeps its order
  and is delivered by the next instruction or turn end
  (`agent.session.inbox.drain_failed`). There is no timer retry.
- A delivered instruction whose state cannot be saved stays `delivering`
  (`agent.session.inbox.state_not_saved`); the next start marks it `uncertain`,
  and it is never repeated.

`unhandledRejection` stays fatal. No handler swallows unknown errors.

## The server stop

`shutdownProcess` runs in a neutral database context, because Node runs an
`unhandledRejection` handler in the async context of the rejected promise. Each
task and each step of the service shutdown is isolated. Each active run is
interrupted separately, and a run that could not be saved still has its executions
aborted; the startup recovery then records it. Exit code 1 stays for every fatal
reason and for any failed step.

### Time budgets

All values are in `SHUTDOWN_LIMITS` (`backend/runtime/ShutdownSteps.ts`).

| Budget                    | Value | Reason                                                                                                                           |
| ------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------- |
| Cleanup, shared           | 30 s  | The former total. One stuck step can no longer use up the time of the close; a step without budget left is started, not awaited. |
| Database close            | 45 s  | Own budget. The longest checkpoint commit in the logs of 2026-11-02 took 41.6 s.                                                 |
| Hard deadline of the stop | 80 s  | Below the 90 s `TimeoutStopSec` default of systemd, after which the database worker would be killed too.                         |
| `closeTimeoutMs`          | 120 s | Unchanged, for closes outside a server stop. It cannot end a server stop.                                                        |

When a budget or the deadline ends the wait, the worker goes on by itself: it sees
the server disappear, checkpoints and exits (`database.worker.closed` on stderr).
The server logs `timed_out`, never `closed`, and exits with 1. A checkpoint longer
than the remaining time of the service manager is killed; DuckDB then replays its
log at the next start. This is a trade-off, not a promise: the budgets come from
one day of logs on one host.

## Deadlines of a write

| Stage                               | Value                  | Note                                                                 |
| ----------------------------------- | ---------------------- | -------------------------------------------------------------------- |
| Writer queue of a request           | 25 s                   | Then 503 with `Retry-After`; the job never started.                  |
| Writer queue of background work     | 10 min                 |                                                                      |
| Commit with an automatic checkpoint | observed 16.1–41.6 s   | No limit exists; a started job is never cancelled.                   |
| MCP client, writes and plan control | 60 s (since MCP 0.3.1) | Was 5 s for most writes.                                             |
| MCP client, imports                 | 30 s                   | Unchanged, a documented public budget with replay by operation ID.   |
| MCP client, short reads             | 5 s                    | Reads no longer wait for the writer; the read queue budget is 10 s.  |
| Reverse proxy of the installation   | 60 s on the known host | Not part of this repository; `proxy_read_timeout` of its nginx site. |

Two deviations remain and are accepted:

- Queue plus a long checkpoint (25 s + 41.6 s) can exceed 60 s. The client then
  sees a transport failure for a change that may have committed; the adapter says
  so and does not resend it. Waiting longer than the proxy gains nothing.
- A short read can give up after 5 s although its queue budget is 10 s. It changes
  nothing, so a repeat is safe. The longest read wait in the logs was 873 ms.

The stdio adapter must be shipped as **pages-mcp 0.3.1** for its budget to apply.
Older bundles keep 5 s, which no longer crashes the server but still reports stored
changes as failed.

## Recovery view

`AgentPlanRecoveryRepository.inspect` runs only SELECTs (the run with its current
snapshot, the latest checkpoint, the latest hundred repair attempts), so it uses
`readTransaction`: one snapshot, no place in the writer queue. A decision taken on
it stays fenced by `expectedRevision` in `control`, which runs on the writer. The
view can lag a write still running by that write's duration; it never shows an
uncommitted state. It is polled every 5 s per open view, and a request still issues
many reads; neither was changed. A composition without `readTransaction` falls back
to the writer, which today only narrow test doubles do.

## Diagnosis

No SQL, parameters, prompts or payloads are logged. New: `failure` and `notStarted`
in the structured error, `server.shutdown.step_failed`,
`server.shutdown.step_timeout`, `server.shutdown.database_close`,
`agent.run.interrupt_failed`, `agent.recovery.startup_summary`,
`agent.session.inbox.recovered`, `database.executor.status`, `database.wal.growth`
and `database.worker.closed`. See `docs/DatabaseExecutor.md`.

## Fire-and-forget audit

Scope: every `void` statement of the server code at `71be28c3` (108 lines in
`backend/` and `app/lib/`, browser code excluded), promise chains without `await`,
promises kept in fields, sets and maps, and async callbacks on timers and emitters.
Routes have no such server-side sites. It was read, not executed.

Secured beyond the cases above:

- `SshClient`: a failed removal of the local scope directory would have been fatal.
- `RemoteConsoleSession.openWithDirectory`: a terminal refused while the directory
  read still ran would have been fatal.

Remaining limits, accepted for now:

- A refused or failed lease write sets `problem = "storage"` in the ACP scheduler,
  and only a restart clears it. Requests can no longer cause it, but an unavailable
  worker still can. Clearing it safely needs its own decision.
- Requests can still refuse a `last_used_at` touch or a Discord delivery kick; both
  only delay bookkeeping.
- `startPicaMobile` creates its gateway outside its `try`; a failure there at boot
  stays fatal, as it should while the server starts.
- `RemoteSessionFollower` has no caller from a route today.
- Internal IPC of `DatabaseWorker.ts` runs in its own process; a failure ends only
  the worker, which the server restarts.

## Decisions deliberately not taken

- **Checkpoint threshold:** unchanged. It needs an isolated, separately authorized
  measurement on a copy first. `database.wal.growth` provides its input.
- **Abort semantics of multi-step changes:** unchanged. A client that leaves between
  the commit and a follow-up such as `threadAssignedTask` can still cost that
  follow-up. Each path needs its own decision.
- **Retries:** none added, and none inside the executor. Only a job with `notStarted`
  in an idempotent step could be repeated at all, never one with `outcome_unknown`,
  and with the background budget no path has shown the need yet.
- **GitHub outbox:** none. A lost publication is logged and caught by a later change
  or sync at best. Whether that closes every gap was not proven; an outbox needs
  evidence of drift and a schema decision.
- **Fair queueing, larger queues:** none. The queues reached 28 of 256 places.
- **Operating goals:** zero crashes, restart within 60 s and RPO 0 stay proposals.
