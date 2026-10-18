# Recoverable plan runs (PAGE-84)

## Verified integration boundary

The starting commit is `d1af4a7` on `task/PAGE-84`, based on `task/PAGE-87`.
The existing `AgentPlanRunEngine` owns the Pages DAG. `AgentPlanStepRunner`
owns execution and assessment, `AgentPlanGroupSessions` retains native group
sessions, and `AcpResourceScheduler` owns global admission and durable leases.
`AgentPlanRunRepository` previously stored the latest public view and one private
snapshot, without a versioned checkpoint or recovery command journal.

`@mastra/core` is pinned to **1.74.0** in both manifest and lockfile. The installed
`dist/workflows/workflow.d.ts` exposes `createRun`, `getWorkflowRunById`,
`Run.resume`, `resumeStream`, and suspend callbacks. Pages has no workflow adapter,
workflow storage, workflow run mapping, or checkpoint restoration contract.
The existing `backend/agents/runtime/README.md` explicitly excludes workflows.
Mastra agent/tool integration and PAGE-81's ACP scheduler are real, separate
facilities; neither is a durable workflow implementation.

PAGE-85 already provides per-session attempts, redacted events, usage, separate
repair messages, continuation capability detection, and bounded reconstruction
text. Its plan recovery paths are deliberately disabled. Pica's ACP resume path
is specific to chat and does not establish a plan recovery contract. Existing
snapshot validation checks workspace identity and live authorization but does
not prove unchanged worktree contents or external ticket/tool effects.

Checklist **2 remains open**: the workflow ticket cannot be identified or its
directed `blocks` link verified from this repository. Ticket access and changes
are prohibited for this task. No ticket ID or integration contract is guessed.
Executing repair/resume of an ended plan is therefore unavailable until that
dependency supplies the workflow mapping, durable storage, fencing, and restore
operation. This change introduces no other scheduler or automatic retry.

## State and failure contract

Existing public statuses stay compatible. An additive `recovery` reason
distinguishes recoverable/interrupted failures from terminal failures; an old
`failed` record without this metadata stays terminal. Recovery eligibility is
not permission to execute or a claim that a native session survived.

| Logical state | Public status / reason | Allowed next states and decisions |
| --- | --- | --- |
| running | running | pause, explicit cancel, succeeded, recoverable failure, terminal failure |
| pausing | pausing | drain all dispatched work; no new starts; then paused or actual completion/failure |
| paused | paused | adopt a revalidated saved plan revision at the persisted frontier of the same run, or stop |
| stopping | stopping + stopRequested | confirm owned execution/session closeout; never resume |
| waiting for input | session state only | the existing session inbox; no new plan scheduler |
| waiting for resources | running plus scheduler wait reason | existing global ACP admission, pause, cancel; waiting is not failure |
| recoverable | failed + recoverable | inspect, record a separate repair instruction, reconcile unknown effects, cancel; execution requires the missing workflow integration |
| interrupted | failed + interrupted | inspect, reconcile, record repair instruction, cancel; never automatically replay |
| failed terminal | failed without recovery, or terminal classification | inspect only; no repair escape hatch |
| cancelled | cancelled or stopRequested | inspect only; never reopen |
| succeeded | succeeded | inspect immutable completions only |

| Failure class | Decision and retry conditions | Terminal condition |
| --- | --- | --- |
| provider/network | inspect effects and select a supported recovery mode explicitly | unknown/unclassified failures default to terminal |
| approval | explicit authorized decision; never grant permissions on behalf of a user | denied current rights prevent control |
| business/build/test assessment | repair instructions and fresh technical/business assessment | build failure does not imply native session loss |
| context/configuration | resolve workspace, input, model and provider mismatch explicitly | no silent snapshot replacement or provider switch |
| timeout | reconcile possible effects, then explicit recovery selection | never automatically retry writes |
| process interruption | tagged-process cleanup, checkpoint inspection and reconciliation | failed cleanup retains capacity/reservations |
| explicit stop/cancel | no recovery | always terminal |

Pages owns business definitions, current authorization, immutable results and
audit history. Mastra must own workflow restoration and dependency release.
ACP owns native session identity, capabilities, isolation, process cleanup and
global capacity. A Pages checkpoint proves none of the native session lifetime.

The existing success policy is preserved: standalone Codex/Claude business
progress stays diagnostic; OpenCode and group members additionally need accepted
business progress. Recovery does not infer a build/test failure from arbitrary
provider text or reinterpret previously confirmed successes.

The three distinct native modes are `live`, `native_resume` and `new_session`.
A live mode needs the exact owned retained process and compatible configuration.
Native resume/load needs an announced adapter capability and a Pages plan path.
A new session needs explicit selection and bounded context, with a new attempt
and session ID. None of these paths is advertised as executable for ended plan
runs until the workflow and context/effect validation boundary is available.

## Durability and privacy

Checkpoints and the successful step view commit in the same DuckDB transaction.
Completion keys are unique per run/node, checkpoint versions increase, and run
revisions fence recovery commands. A duplicate key must match its original
request; reusing it for a different action or payload is a conflict. Successful
outputs and business assessments cannot be replaced by later view updates.
Session closeout metadata may still settle after a retained group turn.

Checkpoints reference the original private snapshot by a SHA-256 digest instead
of copying prompts, credentials or binary assets. Bindings are represented by
their kinds, stable references and digests. Result text is redacted and bounded;
business and technical assessments stay separate. The original snapshot remains
server-only and is never replaced with the currently edited plan. Existing
private snapshots are not retroactively rewritten or certified credential-free.

The existing snapshot pipeline still persists templates and prepared resource
content for new runs. This patch does not introduce a prompt-minimizing snapshot
serializer or an immutable resource-version store. The new checkpoint and
preparation records have the stated redaction and size bounds; that is not a
certification of the existing private snapshot pipeline.

Inline base64 assets are omitted from a checkpoint's display copy of the result.
`isOutputReduced` states whether the copy differs; `outputDigest` identifies the
full original result, which remains unchanged in the run and its existing
archive. The display copy is not silently substituted as a recovery prompt.

Retention follows the owning run/project; there is no automatic expiration of
successful checkpoints or audit history. Per-record bounds and the plan's
100-node limit bound new checkpoint data. Repair instructions are separate,
redacted, bounded records and are never spliced into the original assignment.
No command claims exactly-once behavior for arbitrary external effects. A crash
between a write and durable completion requires reconciliation and an authorized
decision even when a previous checkpoint exists.

Startup reuses instance-tag cleanup and existing ACP lease recovery. It records
interruption without inventing a user stop, preserves successful predecessors,
and starts nothing. An explicit stop persisted before a crash stays terminal.
Unknown PIDs are never used as proof of process ownership. Cleanup uncertainty
stays visible and does not release ACP capacity prematurely.

The existing graceful engine shutdown still requests cancellation. Those
persisted stops remain terminal; recovery does not reinterpret them as an
unexpected crash. Distinguishing a graceful server restart from user cancellation
in the old shutdown contract remains open.

## Server contract

`GET /agent-api/plan-runs/:runId/recovery` reads the current recovery revision,
latest checkpoint, failed nodes, error classes, mode diagnostics, allowed
preparation actions and the latest 100 audit entries. Add `?checkpoint=2` to read
one immutable checkpoint version. Reads require the original executor and the
current plan, workspace, agent, ticket, wiki and asset rights through
`AgentPlanService.run`. They start no process or resource lease.

`POST` to the same endpoint accepts JSON. Every command requires a nonnegative
`expectedRevision` and an `idempotencyKey` of 8–128 ASCII letters, digits,
underscores or hyphens. Keys and the original validated payload are hashed before
persistence; redaction cannot turn two different original instructions into one
idempotent request. Every replay still requires current authorization.

```json
{
  "action": "record_repair",
  "stepId": "failed-node-id",
  "instruction": "Repair the failing test and report fresh evidence.",
  "expectedRevision": 12,
  "idempotencyKey": "repair-request-001"
}
```

`record_repair` appends an inert preparation with its own attempt ID and status
`recorded`. It does not deliver an instruction. `reconcile` requires a failed
`stepId`, `decision: "effects_reviewed"` and a separate `note`; this records the
user's review, not runtime proof that effects can safely repeat. `cancel` is
terminal and cancels unstarted successors without discarding successful results
or releasing uncertain cleanup reservations. Existing live pause/resume routes
retain their previous contract; they are not replaced by this recovery endpoint.
Only actual agent steps of the frozen snapshot accept repair/reconciliation;
group summaries and control nodes do not. Node diagnostics expose this as
`canRecordRepair`.

`resume` requires an explicit mode (`live`, `native_resume` or `new_session`) and
returns `workflow_unavailable` for an eligible ended run. Terminal or stopped
runs return `action_unavailable`. Revision and payload/key mismatches return
distinct conflict codes. Invalid input, access denial and corrupt/oversized
checkpoints also have fixed codes. Responses are uncacheable and do not echo
provider errors. No executing repair, context override or resource override is
accepted through this preparation API.

New checkpoint JSON is bounded to **2 MiB UTF-8**, result text to **200,000
characters**, and repair/reconciliation text to **20,000 characters**. Completed
nodes have one checkpoint each, under the existing 100-node bound. Audit reads
are capped at 100 entries; durable history is retained with its run and removed
by project deletion. There is no checkpoint backfill for old successes.

Migration `057_agent_plan_recovery.sql` adds the revision with default zero and
then sets `NOT NULL`, following migration 004 and the documented
[DuckDB ALTER TABLE contract](https://duckdb.org/docs/current/sql/statements/alter_table).
Prior migrations and public status strings remain unchanged. Unit tests use a
fake transactional store; actual DuckDB DDL execution is not certified by them.

## Checklist accounting

Numbers refer to the ticket's implementation checklist (`I`) and acceptance
checklist (`A`), in their original order. A partial item is not a completed item.

| Item | State | Evidence and remaining work |
| --- | --- | --- |
| I1 | done | Branch/base, all named modules, persistence, tests, runtime and installed SDK inspected. |
| I2 | open | No identified workflow ticket or verified blocks link; ticket access prohibited. Actual core boundaries documented. |
| I3 | done | Compatible state/reason and failure matrix, decisions, ownership and truthful mode diagnostics documented. |
| I4 | partial | Additive migration, immutable versioned checkpoints, revisions, idempotency and separate preparation attempts implemented. Executing attempt lifecycle depends on workflow integration. |
| I5 | partial | Atomic completion/checkpoint and immutable success reports/configuration; technical and business results separate. Resolved group input content is not fully replayable from the new digests alone. |
| I6 | open | Executing repair, reassessment and restored dependency release require the missing workflow adapter. No alternative scheduler implemented. |
| I7 | partial | Verified adapter capabilities and prompt digests persist across restart and group reuse. Failed-node live/native/new-session execution is unavailable. |
| I8 | partial | Current resource authorization, original snapshot references, explicit review and audit enforced for preparations. Worktree-content comparison, model-grant revalidation and executing context decisions remain blocked. |
| I9 | partial | Atomic revision/idempotency/cancel coordination for preparations; existing leases and cleanup retained. No executing recovery admission or waiting queue exists. |
| I10 | partial | Startup preserves successes and checkpoints, records unexpected interruption and uncertainty without retry. Mastra restoration and graceful-restart distinction remain open. |
| I11 | partial | Typed authorized read/preparation/cancel HTTP contract and safe error codes; execution resume/context/resource errors await integration. No UI. |
| I12 | partial | Focused deterministic unit tests with fake SQL/process/provider boundaries. No Mock-Mastra workflow, real DDL migration, live provider or Linux process tests. |

| Item | State | Evidence and remaining work |
| --- | --- | --- |
| A1 | done | Real Pages engine with fake execution and transactional persistence: A kept, B failed, C blocked. |
| A2 | partial | Separate repair preparation recorded; executing repair and C's later release remain unavailable. |
| A3 | partial | Parallel/repeated preparations deduplicate or conflict; no executing resume is offered. |
| A4 | done | Existing live pause/resume completes each original node once. |
| A5 | partial | Original completions/results/assessments/configuration immutable; preparations append only. Executing repair history remains open. |
| A6 | partial | Terminal/explicit-stop protection and cancellation tested; no queued executing resume exists to race. |
| A7 | partial | Restart keeps checkpoints and recorded capabilities without claiming a live native session; no restored workflow execution. |
| A8 | done | Unsupported plan resume returns a fixed reason; no implicit reconstruction or invented session identity. |
| A9 | partial | Fake verified Codex/Claude handshakes and persisted metadata tested; no three-mode provider execution. |
| A10 | partial | Current access rechecked; changed/unknown execution context always blocked. Full live context/model/worktree checks remain open. |
| A11 | open | Recovery queue and retained-session recovery under ACP limit 1 need the workflow integration. Existing resource scheduler is not replaced. |
| A12 | partial | Transaction faults, uncertain completion quarantine, restart and cleanup uncertainty tested. Full parallel restored workflow/timeout matrix remains open. |
| A13 | partial | No automatic write replay; unknown effects and explicit human review recorded. No complete external-effect journal or executing reconciliation. |
| A14 | partial | Legacy public views remain readable; additive migration supplied. No actual DuckDB migration test under the unit-only constraint. |
| A15 | partial | New records use bounded redacted results, omitted inline assets, hashed inputs/keys and references. The existing private snapshot pipeline still needs prompt minimization and a privacy audit. |
| A16 | partial | Current authorization, expected revision, idempotency and action checks tested. Executing context/resource contracts remain unavailable. |

## Focused validation

Exactly the following new unit files were executed, each with
`pnpm exec vitest run --config vitest.backend.config.ts --maxWorkers=1 <file>`.
All final invocations exited **0**: **63 cases**, seven files. The full Backend
suite and the Frontend suite were not run, as required by this task. Every model,
database, process scan and native process boundary was fake or mocked; the ACP
tests use in-memory protocol streams, without a provider login or model call.

| Report | File below `tests/backend/` | Cases |
| --- | --- | --- |
| checkpoints | `backend/service/agents/page84-checkpoints.unit.test.ts` | 12 |
| controls | `backend/service/agents/page84-recovery-controls.unit.test.ts` | 22 |
| runs | `backend/service/agents/page84-run-checkpoints.unit.test.ts` | 8 |
| capabilities | `backend/agents/acp/page84-recovery-capabilities.unit.test.ts` | 5 |
| session | `backend/service/agents/page84-session-metadata.unit.test.ts` | 4 |
| http | `app/routes/page84-plan-recovery.unit.test.ts` | 8 |
| step | `backend/service/agents/page84-step-metadata.unit.test.ts` | 4 |

Each invocation generated the configured diagnostic Backend reports. The local
`coverage/page84-<report>-coverage.json` files retain their per-module summaries;
`coverage/page84-<report>-test.log` files retain terminal output. These generated
files are not committed. The table below reports each named invocation's own
percentages (statements, branches, functions, lines), without aggregating reports.
The normal report also includes every other configured source file, including
zeros. No coverage threshold, ignore comment or exclusion was added.

| Report | Source module | S | B | F | L |
| --- | --- | ---: | ---: | ---: | ---: |
| checkpoints | `recovery/AgentPlanCheckpoint.ts` | 82.35 | 73.17 | 89.47 | 85.71 |
| checkpoints | `agent/AgentPlanCheckpointRepository.ts` | 95 | 85.71 | 100 | 95 |
| checkpoints | `agent/AgentPlanProgressRepository.ts` | 83.63 | 78.33 | 89.47 | 84 |
| checkpoints | `agent/AgentPlanRunRepository.ts` | 10.71 | 6.45 | 15.78 | 11.76 |
| checkpoints | `agents/AgentPlanContentDigest.ts` | 100 | 50 | 100 | 100 |
| controls | `recovery/AgentPlanRecoveryService.ts` | 83.33 | 64.1 | 100 | 84.84 |
| controls | `agent/AgentPlanRecoveryRepository.ts` | 93.75 | 89.58 | 100 | 96.55 |
| controls | `recovery/AgentPlanFailure.ts` | 92.3 | 85.71 | 100 | 100 |
| controls | `agents/AgentPlanRecoveryInput.ts` | 100 | 80 | 100 | 100 |
| controls | `agents/AgentPlanRunInput.ts` | 70.58 | 78.94 | 100 | 75 |
| controls | `definition/AgentPlanRecovery.ts` | 100 | 100 | 100 | 100 |
| runs | `recovery/AgentPlanStartupRecovery.ts` | 94.73 | 86.36 | 100 | 94.73 |
| runs | `agents/AgentPlanRunEngine.ts` | 68.18 | 74.33 | 70.49 | 70 |
| capabilities | `agents/acp/AcpSession.ts` | 55.24 | 35.21 | 70.27 | 56.95 |
| session | `sessions/AgentSessionService.ts` | 18.89 | 16.52 | 19.35 | 20.75 |
| session | `agents/AgentPlanSessionInput.ts` | 46.83 | 43.87 | 63.63 | 46.03 |
| http | `app/routes/agent-plan-recovery.ts` | 100 | 100 | 100 | 100 |
| http | `app/lib/agent-plan-recovery-response.server.ts` | 100 | 83.33 | 100 | 100 |
| step | `agents/AgentPlanStepRunner.ts` | 76.56 | 60.47 | 75 | 79.65 |
| step | `agents/AgentPlanGroupSessions.ts` | 68.18 | 59.7 | 76.92 | 73.46 |
| step | `agents/AgentPlanSessionRecords.ts` | 77.41 | 72.91 | 92.3 | 95.83 |
| runs | `app/lib/agent-plan-services.server.ts` | 0 | 0 | 0 | 0 |
| runs | `app/lib/services.server.ts` | 0 | 0 | 0 | 0 |
| runs | `app/routes.ts` | 0 | 0 | 0 | 0 |
| runs | `agents/AgentPlanService.ts` | 0 | 0 | 0 | 0 |
| runs | `agents/AgentPlanExecution.ts` | 0 | 0 | 0 | 0 |
| runs | `project/ProjectAgentDeletion.ts` | 0 | 0 | 0 | 0 |

Short source paths are relative to `backend/service/`, `backend/database/repositories/`
or `backend/` as their directory indicates. Complete source paths and counters
are in each JSON report. The application composition, original authorization
facade, execution wrapper and project-deletion cleanup are not executed by these
focused units. They are checked statically, not certified functionally by a
zero-coverage module. Native timeouts/cleanup, actual filesystem changes,
model/role withdrawal, corrupt database branches, all recovery modes and actual
DuckDB migration execution remain gaps. Coverage of legacy methods in the run
repository is not a target of the new tests.

The parallel-branch fault regression also verifies that an independent successful
completion can still persist while the uncertain node stays quarantined. An
automatic storage fault does not set the user's `stopRequested` flag. No
dependent work or retry starts.

Non-test gates are the repository's `pnpm run check` (React Router typegen,
TypeScript and Prettier) and
`node --max-old-space-size=3072 node_modules/eslint/bin/eslint.js . --max-warnings=0`.
These gates do not establish functional or coverage validation.

## Remaining integration work

The full PAGE-84 definition of done depends on the missing Mastra workflow
integration: executing a repair, re-assessment before dependency release,
continuing open DAG branches, and all three provider-specific native modes.
Unchanged worktree contents, original resolved group inputs, and arbitrary
external tool effects also need durable evidence before execution can be enabled.
There is no UI, console, provider call, new ACP capacity manager, or background
recovery worker in this change.
