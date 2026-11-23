# Automation repositories

This inventory covers the 5 executable modules in
`backend/database/repositories/automation/`. They store automations, their runs,
the events that start them, the deliveries to agents and the notification
choice of a person. The inventory was taken from the source tree of this
revision and records what exists; it makes no claim about test or coverage
results.

## Current state

- All 5 modules are executable. Each declares a class, so none is a pure type
  or re-export file and none is exempt from measurement. The interfaces and the
  `DEFAULT_AUTOMATION_NOTIFICATION` constant sit next to those classes.
- No test file exists in this directory, and no other test file selects these
  modules. All 5 modules belong to this inventory and to no other.
- The modules are not yet selected by `BACKEND_COVERAGE_SECTIONS` in
  `vitest.backend.config.ts`; no section covers `backend/database/`. A section
  needs its test files first: without them the per-file coverage report would
  reject every module as missing a measurement. Add the section together with
  its tests.
- No module reads the clock. Every time (`queuedAt`, `startedAt`, `endedAt`,
  `now`, `since`, `before`) arrives as an argument, so a test controls time by
  the values it passes and needs no fake timers.
- All modules take the `Database` (`query`, `execute`), an open
  `DatabaseTransaction` or both, passed to the constructor. A test mocks that
  executor; no PostgreSQL instance is needed.

## Executable modules

"Executor" means the object passed to the constructor. Row values are plain
`DatabaseValue` arrays read by position through `RowValue`.

| Module                                          | Responsibility                                                            | Boundary a test controls                                      |
| ----------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `AutomationRepository.ts`                       | reads, lists, locks, inserts, replaces, schedules and deletes automations | executor, `automationTriggerSchema`, `automationActionSchema` |
| `AutomationRunRepository.ts`                    | queues, claims, delivers, finishes, lists, counts and prunes runs         | executor                                                      |
| `AutomationEventRepository.ts`                  | records, reads and removes events for the scheduler                       | executor                                                      |
| `AutomationAgentJobRepository.ts`               | queues, starts, finishes, lists and prunes deliveries to agents           | executor                                                      |
| `AutomationNotificationPreferenceRepository.ts` | reads and stores when a person hears about runs                           | executor                                                      |

## Behaviors a test has to cover

- Schedule triggers: `due` selects active automations whose `next_run_at` is not
  after `now`, oldest first and limited; `schedule` moves the due time, also to
  `null`, without a new revision.
- Event triggers: `record` inserts only while an active automation waits for the
  type; `waitingFor` lists those automations; `next` returns events in order and
  skips a row with an unknown type; a sequence that is neither a number nor a
  bigint raises an error; `remove` deletes through a sequence.
- Claiming runs: `enqueue` returns the new waiting run, or the run that already
  waits with `isCoalesced`, and raises an error when the waiting run vanished
  between the two statements; `startable` leaves out automations that have an
  accepted or delivered run; `claim` succeeds once and refuses a second caller;
  `deliver` keeps the stored plan run when none is passed; `open` lists the
  unfinished runs; `blocking` returns the oldest queued, accepted or delivered
  run.
- Repeatability: `finish` ends a run once and refuses an ended run, and fills
  every optional field with its default; `markPaused` is repeatable; an
  agent delivery of the same run, agent and kind is added once; `finish` of a
  delivery does not change an ended one; `replace` writes only for the expected
  revision and returns `false` otherwise.
- Results: a stored run row maps to `StoredAutomationRun`, including bigint and
  missing numbers, an unknown trigger kind (falls back to `manual`), an unknown
  status (falls back to `failed`), an unknown outcome and forward state (become
  `null`); a delivery row falls back to the kind `action` and the state
  `failed`; `latest` maps to the newest run per automation; `list`, `latest`
  and `forRuns` return early without a query for an empty ID list; `count` and
  `countEventRunsSince` return `0` without a row; `startedPlanRun` is true for
  a matching row.
- Visibility and paging: `list` of automations passes the viewer, the administrator
  flag, the name filter, the active filter and the keyset, with the defaults for
  absent values; the sharing of a row reads as project, group or private, also
  when a target is missing; an unknown notification mode reads as `off`, and a
  mode other than `off` keeps the agent ID; the notification choice defaults to
  `error` without a row or with an unknown mode.
- Cleanup: `prune` keeps the given number of newest runs and removes only ended
  ones; `pruneEnded` removes ended deliveries without a run that completed
  before a time; `interrupted` lists the delivered ones; `delete` removes an
  automation.
- Error paths: a row with a missing or non-text required column raises the
  `RowValue` error; a trigger or action JSON that is invalid or does not fit its
  schema raises an error and does not return a run; an executor that rejects
  propagates the error.
