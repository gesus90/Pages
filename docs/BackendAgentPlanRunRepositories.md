# Agent plan run and runner repositories

This inventory covers 38 executable modules: the 9 modules in
`backend/database/repositories/runner/` and the 29 modules directly in
`backend/database/repositories/agent/` whose name starts with `AgentPlan` or
`Plan` and that the
[plan definition and access inventory](BackendAgentPlanRepositories.md) does
not list. They hold plan runs, run state, checkpoints, loop iterations, step
reports and progress, recovery, workspace locks, swarm memory, invocations and
the runner state. The inventory was taken from the source tree of this
revision and records what exists; it makes no claim about test or coverage
results.

## Current state

- All 38 modules are executable. None consists only of type declarations or
  named re-exports, so none is exempt from measurement. `AgentPlanInvocationRepository.ts`
  and `AgentPlanSwarmMemoryRepository.ts` re-export types next to a class and
  stay measurable because of that class.
- Two test files exist in these directories and belong to this inventory:
  - `agent/AgentPlanRestartRetirement.test.ts` (3 cases) controls the
    transaction and calls `retireRestartSource` of
    `AgentPlanResourceReservation.ts`. It needs no database.
  - `runner/RunnerRepositoryArchive.test.ts` (2 cases) starts a scratch
    PostgreSQL through `scripts/postgres-restore-check/postgres-programs` and
    runs `RunnerRepository`. The suite is skipped unless
    `/usr/lib/postgresql/18/bin/postgres` exists on Linux, so it yields no
    measurement without that binary.
- Tests of the same plan topics outside these directories
  (`backend/agents/AgentPlan*.test.ts`, `backend/service/agents/`,
  `backend/service/runner/`, `backend/runtime/Runner*.test.ts`) test other
  modules and belong to the areas of those directories.
- The modules are not yet selected by `BACKEND_COVERAGE_SECTIONS` in
  `vitest.backend.config.ts`; no section covers `backend/database/`. A section
  needs its test files first: without them the per-file coverage report would
  reject every module as missing a measurement. Add the section together with
  its tests.

## Executable modules

The boundary column was derived from the imports of each module. It names what
a test has to control. "Executor" means the `Database` or `DatabaseTransaction`
passed in by the caller; it is mocked, so no PostgreSQL instance is needed.
"Payload store" is `AgentPayloadFileStore` (stored payload files), "observers"
is `sharedAgentPlanRunObservers`, and "logger" is `Logger`.

| Module                                          | Responsibility                                         | Boundary a test controls                                                                                          |
| ----------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `agent/AgentPlanAgentTodoRepository.ts`         | agent todo lists of a run and swarm todos              | executor                                                                                                          |
| `agent/AgentPlanCheckpointRepository.ts`        | appends, finds and lists plan checkpoints (size limit) | executor, `AgentPlanRecoveryError`                                                                                |
| `agent/AgentPlanCleanupFailureRepository.ts`    | appends and reads the latest cleanup failure           | executor, `AgentPlanRecoveryError`                                                                                |
| `agent/AgentPlanContinuationRepository.ts`      | adopts and reads plan snapshots for a continued run    | executor, `AgentError`                                                                                            |
| `agent/AgentPlanHandoverLocks.ts`               | hands workspace locks over and returns them            | transaction, `AgentError`                                                                                         |
| `agent/AgentPlanInvocationRepository.ts`        | invocation lifecycle: start, decision, signal, detach  | executor, `AgentError`                                                                                            |
| `agent/AgentPlanLoopIterationRepository.ts`     | appends loop iteration checkpoints                     | transaction, `AgentPlanRecoveryError`                                                                             |
| `agent/AgentPlanProcessedTickets.ts`            | clears processed ticket entries of a plan              | transaction, change notification, logger                                                                          |
| `agent/AgentPlanProgressRepository.ts`          | persists run progress, interrupt and remote retry      | executor, payload store, observers, checkpoint and iteration repositories                                         |
| `agent/AgentPlanPurgeRetry.ts`                  | defers a failed run purge for a later retry            | executor, logger                                                                                                  |
| `agent/AgentPlanRecoveryExecutionRepository.ts` | recovery executions: replay, restart, settle stopped   | executor, payload store, observers, lock release, resource reservation                                            |
| `agent/AgentPlanRecoveryRepository.ts`          | inspects, controls and advances a recovery             | executor, payload store, `node:crypto` identifiers                                                                |
| `agent/AgentPlanResourceReservation.ts`         | reserves plan resources, retires a restart source      | transaction, payload store, `AgentError`                                                                          |
| `agent/AgentPlanRunPurge.ts`                    | queues and runs the purge of earlier and obsolete runs | executor, payload store prefix, run failure repository and indexer                                                |
| `agent/AgentPlanRunRepository.ts`               | creates, reserves, lists, updates and releases runs    | executor, payload store, workspace reference, continuation and progress repositories, lock release, purge, logger |
| `agent/AgentPlanRunRetention.ts`                | settled-run rules and the purge batch size             | none (constants and a derived rule list)                                                                          |
| `agent/AgentPlanRunVisibilityRepository.ts`     | visibility bases of runs and their resources           | executor, payload store, logger                                                                                   |
| `agent/AgentPlanStartRejectionRepository.ts`    | appends and pages rejected plan starts                 | executor                                                                                                          |
| `agent/AgentPlanStartResourceRepository.ts`     | start conflicts, local owners, retire and complete     | executor, payload store, observers, handover locks, logger                                                        |
| `agent/AgentPlanStepProgressRepository.ts`      | finds, lists and saves step progress                   | executor                                                                                                          |
| `agent/AgentPlanStepReportRepository.ts`        | opens, finds, saves and closes step reports            | executor                                                                                                          |
| `agent/AgentPlanSwarmMemoryRepository.ts`       | swarm memory: publish, reject, compact, read, adopt    | executor, `node:crypto` identifiers                                                                               |
| `agent/AgentPlanSwarmMemoryWrites.ts`           | memory entry publish and compact statements            | executor                                                                                                          |
| `agent/AgentPlanSwarmRepository.ts`             | saves and finds the swarm board and its todos          | executor, todo repository                                                                                         |
| `agent/AgentPlanWorkRepository.ts`              | finds and inserts plan work records                    | transaction, payload store                                                                                        |
| `agent/AgentPlanWorkspaceLockRelease.ts`        | releases checked workspace locks of a run              | transaction, `AgentPlanRecoveryError`, logger, handover locks                                                     |
| `agent/AgentPlanWorkspaceLockRepository.ts`     | lists, releases and hands over workspace locks, leases | executor, ACP resource repository, lease release, lock release                                                    |
| `agent/PlanRunCommandRepository.ts`             | run commands: insert, deliver, apply, fail, latest     | executor, payload store, `node:crypto` identifiers                                                                |
| `agent/PlanRunOwnerRepository.ts`               | acquires the session lock that marks the run owner     | `PostgresSessionLock`                                                                                             |
| `runner/RunnerDeployKeyRepository.ts`           | lists and creates runner deploy keys                   | executor, `node:crypto` identifiers                                                                               |
| `runner/RunnerHistoryRecoveryRepository.ts`     | retains and restores job history for a reconnect       | executor                                                                                                          |
| `runner/RunnerMaintenanceRepository.ts`         | maintenance settings, requests and recorded state      | executor                                                                                                          |
| `runner/RunnerPlanEventRepository.ts`           | plan events of a runner: receipt, fence, apply         | executor, payload store, workspace reference, history recovery, progress repositories                             |
| `runner/RunnerRepository.ts`                    | runner records, jobs, checkpoint, reconnect, remove    | executor, agent todo repository                                                                                   |
| `runner/RunnerSessionEvents.ts`                 | prepares and persists runner session events            | transaction, payload store                                                                                        |
| `runner/RunnerSessionReadings.ts`               | persists a runner session reading                      | transaction                                                                                                       |
| `runner/RunnerSessionUsage.ts`                  | persists the token usage of a session                  | transaction, session usage writer                                                                                 |
| `runner/RunnerStructuredProgress.ts`            | persists structured progress, usage and todos          | transaction, session and todo repositories                                                                        |

## Behaviors a test has to cover

- Status transitions: runs move through reserve, update, interrupt and release;
  a settled run is not changed again (immutable success and iterations);
  invocations move through start, decision, timeout, signal and detach; a
  stopped run settles through recovery.
- Checkpoints and iterations: a checkpoint is appended and found by identity,
  an oversized record raises `checkpoint_too_large` and an invalid one
  `checkpoint_invalid` (checkpoints and loop iterations both limit a record to
  2 MiB), and a loop iteration is appended as a checkpoint of its run.
- Reports and progress: step reports open, save and close; step progress and
  run progress are saved and read back; the remote retry counter is reset.
- Resume: a continued run adopts the current snapshot, a recovery replays,
  retires a restart source or records a reset, and a restart that names a run
  of another plan is refused.
- Locks: workspace locks and leases are listed, handed over, returned and
  released; a run that still holds an owner or writer lock blocks a start;
  the run owner lock is acquired with `pg_try_advisory_lock`, the engine and
  api roles use different locks, and a lost lock calls the `lost` callback.
- Cleanup: purging earlier, all and obsolete runs, a deferred purge that is
  retried, cleanup failures that are appended and read, runner jobs archived
  only for a run that still exists, and the removal of a runner record.
- Session data: a step without terminal data, with the `api` runner or with an
  unknown provider writes no usage.
- Persistence errors: an executor that rejects propagates the error.
