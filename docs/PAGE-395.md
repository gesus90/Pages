# PAGE-395: bounded workspace cleanup and safe restart cleanup

## Behavior

Cleanup selects only due pending rows through the partial `agent_workspace_cleanup_due`
index. Failed attempts wait 2 seconds, 10 seconds, 1 minute, 5 minutes, then
15 minutes. Eight failures or 24 hours since the last genuine event move the
obligation to `needs_decision`. No timer checks that state. Existing obligations
older than 24 hours receive one check on their first startup, then need a decision
unless process freedom was proven. Completed obligations are never reopened.

The run's committed view change resets retries in PostgreSQL, including changes
written by another process. A validated offline-to-online runner transition also
resets only that runner's obligations, including reconnections that retain the same
session ID. Startup makes pending retries immediately due without resetting their
age; the owner's explicit retry starts a new attempt budget.

`updated_at` changes only with state or blocker. Retry counts and due times have
separate updates. Stop delivery is claimed once per obligation/event revision.
One reconciliation caches each run once. Runs with no possible session process
need neither uptime discovery nor a process scan; legacy uncertainty stays closed.

The plan panel shows the retained blocker and decision state, with **Erneut prüfen**
and **Als erledigt freigeben**. The second action requires an explicit attestation
that every process ended, for example following a verified host reboot, and stores
`manual_release_host_reboot_verified`. The POST action checks origin, current plan
execution rights, original run owner and exact workspace/run identity.

## Restart ordering

The server performs these phases before preparation or dispatch:

1. Read native owners and stop an engine that still drives the predecessor.
2. End every persisted ACP lease's worker unit by its recorded name, check its
   active state, and end its owned namespace. Legacy leases without either boundary
   remain quarantined until **older than** 15 minutes; invalid dates also refuse.
3. Close remaining local/remote sessions, scripts and local owners; check process
   and loop evidence. A missing or unknown loop session cannot be inferred away.
4. Recheck the lease boundaries and atomically release ACP reservations, workspace
   locks and local bindings, then end the predecessor. A failed transaction retains
   all durable reservations and proof. The command's recovery revision remains valid.
5. Prepare the saved plan and start its new run. Cleanup adds no Git operations.

Every cleanup phase permits at most three attempts. A final failure stops execution
before preparation/start and returns `cleanup_unconfirmed` with `cleanupFailure.stepId`
and a bounded reason, including `worker_unit_active`, `lease_too_recent` and
`engine_active`. Private subprocess messages are not returned.

A completed cleanup marker includes the hash of the exact canonical ended run.
It permits another restart after a later preparation failure, while a changed
run view invalidates the evidence. Historical session results remain historical.
The fresh-start transaction no longer creates another pending cleanup obligation
for an already verified predecessor. Pending decision rows still protect run purge,
environment reuse and project deletion.

## Focused function tests

All test boundaries use mocks/stubs; these unit files start no database, agent,
MCP process or external service. Coverage is explicitly disabled.

```sh
NODE_ENV=test node node_modules/vitest/vitest.mjs run \
  --config vitest.backend.config.ts --coverage.enabled=false \
  tests/backend/backend/service/agents/page395-workspace-cleanup.unit.test.ts \
  tests/backend/backend/service/agents/page395-restart-cleanup.unit.test.ts \
  tests/backend/backend/service/agents/page395-cleanup-decisions.unit.test.ts \
  tests/backend/backend/service/agents/page395-process-evidence.unit.test.ts \
  tests/backend/backend/service/runner/page395-cleanup-reconnect.unit.test.ts \
  tests/backend/backend/agents/cli/page348-recorded-worker-unit.unit.test.ts

NODE_ENV=test node node_modules/vitest/vitest.mjs run \
  --config vitest.frontend.config.ts --coverage.enabled=false \
  tests/frontend/app/components/agents/plans/page395-workspace-cleanup.unit.test.tsx
```

The backend cases cover retry timing, the eight-attempt and age boundaries,
UTC database timestamps, startup/reset events, unchanged-state SQL guards, stop
suppression, automatic namespace settlement, unavailable scans, the recorded unit
stop/check sequence, the 15-minute quarantine, retained leases on transaction
failure, restart from failed/cancelled/stopping states with unconfirmed session
history, exact-view proof reuse and three final failures with a safe response.
The two frontend cases exercise retry and attested manual release.

Full backend/frontend suites, lint, check, typecheck, build, format verification
and coverage: **an die Abschluss-QA übergeben**, as required by this run.

## Disposable-instance measurement

Baseline: `origin/main` = `d5a140e2f83bf0714be873925394db45136746e0`.
Both variants use source-loaded Vite runtimes (no build), an actual separate
`RunsEntry.startRuns` process and the API on a dynamically allocated loopback port,
plus their own `TemporaryPostgres` PostgreSQL 18 cluster and isolated home/config,
cache, state and data directories. No shared Pages service, database, live port,
real credentials, session plan or model invocation is used.

Each fresh database contains the same nine synthetic failed terminal runs and nine
October 30 cleanup obligations: five failed session closeouts and four confirmed
legacy session records without independently provable containment. The initial
blockers reproduce `process_end_unconfirmed` ×5 and `process_scan_unavailable` ×4.
There is no active model or plan execution; this isolates idle cleanup cost.
The fixture uses Pages' existing synthetic recovery fixture and actual migrations.

The measurement samples `pg_stat_user_tables` before and after 600 real seconds
following readiness. CPU is the delta of the exact `pages-runs` PID's `/proc` user
and system CPU ticks; `CLK_TCK = 100`. CPU percentage refers to one core. Source
watchers and startup behavior are the same in both variants. Absolute CPU numbers
for these small synthetic runs are not the large payloads of the shared server.

The first exploratory comparison measured:

| Metric | origin/main | Session implementation |
| --- | ---: | ---: |
| Elapsed milliseconds | 600271 | 600540 |
| `n_tup_upd` before → after | 45 → 2745 | 18 → 18 |
| Updates in ten minutes | 2700 | 0 |
| `seq_tup_read` before → after | 45 → 25911 | 0 → 0 |
| CPU ticks | 830 | 505 |
| CPU seconds | 8.30 | 5.05 |
| CPU per core | 1.3827% | 0.8409% |

The branch startup performed 18 one-time row updates: nine stop claims and nine
transitions to `needs_decision`. The resulting reasons stayed at 5 + 4, with no
row marked completed. The terminal state requires an event/person before another
attempt, rather than extrapolating continued periodic writes from the short window.

## Evidence by Pages todo

| Todo | Proof |
| --- | --- |
| T1 | Real PostgreSQL `n_tup_upd`/`seq_tup_read` deltas over ten minutes, above; all nine duties retain uncertainty. |
| T2 | User + system CPU ticks of the exact standalone runs PID, same fixture and duration, above. |
| T3 | `page395-workspace-cleanup.unit.test.tsx`: visible reason/decision state, actual retry POST and required release confirmation. `page395-cleanup-decisions.unit.test.ts`: current-owner authorization. |
| T4 | `page395-process-evidence.unit.test.ts`: an owned namespace first remains alive, then ends; only the latter releases and completes the obligation. |
| T5 | `page395-restart-cleanup.unit.test.ts`: failed/cancelled/stopping predecessors with failed session history; units and legacy lease policy. `page395-cleanup-decisions.unit.test.ts`: atomic lock/lease/binding release and retirement. |
| T6 | `page395-restart-cleanup.unit.test.ts`: exactly three failures, no preparation/start and 409 with step/code; transient failure can succeed within the budget. |
| T7 | Focused backend files above plus four retained PAGE-348 unit command tests. Full suite/coverage execution is an die Abschluss-QA übergeben. |

The run used no genuine agent/model calls. Shared test-server post-deployment
measurements remain outside this ticket's acceptance. The native mobile app,
restart dialog, active-plan coordination and the unified runner are unchanged.

## Final frozen-source verification (14 November 2026)

All 29 changed production files matched the frozen measurement copy, with aggregate
SHA-256 `38ae305d6a191b059cca908b0e8fbdea3425cfa3f913778547a18beac43d6572`.
The final source copy was not edited during this window.

| Metric | origin/main | Final session sources |
| --- | ---: | ---: |
| Elapsed milliseconds | 600271 | 600387 |
| `n_tup_upd` before → after | 45 → 2745 | 18 → 18 |
| Updates in ten minutes | 2700 | 0 |
| `seq_tup_read` before → after | 45 → 25911 | 0 → 0 |
| Rows inserted before → after | 9 → 9 | 9 → 9 |
| CPU ticks | 830 | 405 |
| CPU seconds | 8.30 | 4.05 |
| CPU per core | 1.3827% | 0.6746% |

That is 51.23% less CPU time and no steady-state cleanup writes. All nine rows
remain `needs_decision`, split into `process_end_unconfirmed` ×5 and
`process_scan_unavailable` ×4. The 18 branch writes happen once at startup;
no obligation was inferred completed from age or a missing ownership marker.

After taking the final counters and CPU sample, the same disposable PostgreSQL
was used for two event diagnostics with the actual production SQL:

- `RunnerRepository.reconnected` woke exactly nine matching obligations.
- A committed run view update changed an exhausted obligation to `pending`,
  `attempts = 0`, `next_attempt_at = 0`, `event_revision = 2`.

These diagnostic writes are outside the measured window. The API, runs process,
PostgreSQL supervisor and its private cluster were stopped; the isolated instance
homes, configuration and databases were removed. Temporary source copies and
measurement harness files were also removed before the local handoff.

Final targeted unit evidence: **29 backend cases passed** (25 new PAGE-395 cases
and four existing PAGE-348 unit command cases); **2 frontend cases passed**.
The final extra backend proof test was run in the focused three-case decisions
file after the initial 28-case six-file run. No full suite, coverage, lint,
typecheck, check or build was executed.
