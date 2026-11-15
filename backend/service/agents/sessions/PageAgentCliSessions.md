# PageAgentCLI sessions (PAGE-85, PAGE-284)

PageAgentCLI is the controlled interface to the session of a plan node. Since
PAGE-284 every local plan node runs over ACP, whether Claude Code, Codex,
OpenCode or Antigravity, and the plan console shows its stored ACP history in
the Pages terminal (section "Pages terminal" below). The PTY terminals of
PAGE-265 are removed. It is no system shell: input reaches only the session
of the node, and only from a person who may run the plan. This document
covers the backend; the plan console is its only surface.

## Verified starting point

Checked on `task/PAGE-85` (base `e87743b`) before the change:

| Area                             | Finding                                                                                                                                                                                                                                                                                      |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AcpSession`                     | Pages is the ACP client. `usage_update` (`used`, `size`, `cost`) reached only the Pica listener; plan nodes kept no context statistic. `PromptResponse.usage` was read only by Pica. `initialize` read steering and prompt capabilities, not `loadSession` or `sessionCapabilities.resume`.  |
| `AcpEvents` / `CliSessionEvents` | Plan sessions kept at most 60 short lines of 200 characters (`noteSessionEvent`); the record stored them redacted. That buffer is no chat history.                                                                                                                                           |
| Session record                   | `AgentPlanSessionRecord` holds runner, mode, instance, ACP session ID, process, requested configuration, `effective` (adapter-reported model, effort, mode, adapter, isolation), contract, acceptance and the short events. No attempt identity: members of an ACP group share `instanceId`. |
| Groups                           | `AgentPlanGroupSessions` holds one process and ACP session per run and group, queues member turns (`reserve`) and refuses a lost session (`plan_group_session_lost`).                                                                                                                        |
| Resources                        | `AcpResourceScheduler` admits every ACP start FIFO; `ScheduledAcpSession` keeps the lease across turns until its owner closes the session. Plan and Pica starts already go through it.                                                                                                       |
| Recovery                         | `AgentPlanRecovery` ends processes of interrupted runs and marks them failed; there is no API that continues a failed or interrupted run. Pica resumes its own conversations with `session/resume`.                                                                                          |
| Operation locks                  | `AgentOperationRegistry` locks model connections against login and credential changes, not sessions.                                                                                                                                                                                         |

## Identity

A session is addressed by `AgentSessionKey { planId, runId, stepId, attemptId }`.
Every new record gets a random `attemptId`. Members of an ACP group share the
process instance but never the attempt, so their turns, events, usage and
instructions stay apart. Records from before PAGE-85 have no `attemptId`; their
attempt is derived as `instanceId:stepId` and read as legacy.

`requireSessionAttempt` accepts a key only when plan, run, node and attempt
belong together in a run that `AgentPlanService.run` returned for the reader,
which checks the executor's current rights to plan, workspace, agents and
tickets. Any other key fails with `plan_access_denied`.

## Persistence (migration 056)

| Table                      | Content                                                                                                                                                                                         |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent_session_attempts`   | One row per attempt: key, executor, provider, instance, group, state, next event sequence, context occupancy, confirmed model and effort with source and time, checked workspace and Git state. |
| `agent_session_events`     | Redacted events with `(attempt_id, sequence)` as key, turn, kind, truncation flag and an optional dedupe key.                                                                                   |
| `agent_session_turn_usage` | Token counts per attempt and turn; a repeated report of a turn replaces the first.                                                                                                              |
| `agent_session_messages`   | Additional and repair instructions with their delivery status, apart from the frozen plan prompt.                                                                                               |

Older runs keep their records unchanged; they get no rows. Their history is
the short event list of the record (`source: "legacy_record"`); context,
tokens and confirmed values are `null` (unknown).

## Events

Kinds: `user_instruction`, `repair_instruction`, `agent_message`,
`tool_started`, `tool_completed`, `tool_failed`, `plan`, `status`, `error`,
`recovery`, `usage`. The recorder of an adapter process turns ACP updates into
events: message chunks become one `agent_message` when a thought, tool call or
plan ends the message or the prompt ends; tool calls carry a dedupe key per
call and status, so a repeated update is stored once.

- Order: appends of one attempt run one after another; sequences start at 1
  and only grow. The event ID is `attemptId:sequence`.
- Payload storage: new event bodies and immutable history chunks are synchronized
  in the private data directory before their reference transaction. Reads verify
  size and SHA-256; missing/corrupt files fail explicitly. Legacy inline rows
  remain readable without migration. See [AgentPayloadStorage.md](../AgentPayloadStorage.md).
- Crash consistency: numbering, insert, sequence update and retention run in
  one database transaction.
- Redaction: the project credential mask of the session, then
  `sanitizePlanOutput`, then the size limit, so a cut never splits a secret.
- Limits: 4,000 characters per event (marked `isTruncated`), 20,000 per
  instruction, 200 events per page, 2,000 events per attempt (older ones are
  removed; `retainedFrom` names the first kept sequence).

## Service API (`AgentSessionService`)

| Method                                   | Behaviour                                                                                                                                                                                                                                                |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `view(userId, key)`                      | `AgentSessionView`: state, group, workspace, requested and confirmed model, context, turns, per-provider sums of the attempt (`totals`) and of the run (`runTotals`), continuation, instructions and allowed actions.                                    |
| `history(userId, key, { after, limit })` | One page after a cursor. Reconnect with the last `cursor`: no duplicates, no gaps.                                                                                                                                                                       |
| `follow(userId, key, after, listener)`   | Stored events after the cursor, then live events, each once. Returns the stop function. It reads the journal only: no process, no resource slot, no lease extension.                                                                                     |
| `send(userId, key, { kind, text })`      | Stores the instruction and its event first. `queued` while a turn of the native session runs, otherwise delivered at once. Errors: `plan_run_unavailable` (run ended), `plan_session_unavailable` (no open native session), `plan_invalid` (empty text). |
| `cancel(userId, key, "turn" \| "run")`   | `run` stops the whole run through `AgentPlanService.stop`; `turn` cancels only the running instruction turn where the adapter path supports it and otherwise reports `nothing_running`.                                                                  |

States: `starting`, `running`, `waiting_for_input`, `idle`,
`waiting_for_capacity` (the node waits in the ACP scheduler), `recovering`,
`ended`, `failed`, `cancelled`. A stored active state of a run that is no
longer active reads as `ended` or `failed`, so a server stop never leaves a
session that looks alive.

### Delivery and locks

- One native session never gets two writes: the inbox serializes deliveries
  per process instance and waits for a running turn; group instruction turns
  additionally take a place in the group's queue, after the member's turn and
  before any later member.
- Exactly once: a message moves `queued → delivering → delivered | failed`
  only from the expected status. A delivery that a stopped server left in
  `delivering` becomes `uncertain` at the next start and is never repeated.
  A failed write is not retried; its side effects are unknown.
- Before every native write the run is read again through
  `AgentPlanService.run`, so revoked rights or an ended run stop the delivery.
- The plan prompt pinned at the node's start never changes; instructions are
  separate rows and events.

### Continuation

`decideContinuation` reports `live` for an open native session, `resume` or
`load` only when the adapter confirmed the capability in `initialize`,
and only where Pages has a path for it, `reconstructed` only where a new
session with bounded context (`reconstructedContext`) is allowed and marked as
such, otherwise `unavailable` with a reason (`access_denied`,
`configuration_incompatible`, `native_session_ended`,
`pages_resume_unavailable` when the adapter could continue but Pages cannot,
`capabilities_unknown`). A plan checkpoint is reported
apart (`hasPlanCheckpoint`); it is plan recovery, not native recovery.

Open group sessions are offered as `live` for instructions between turns; a
single node takes input in its running turn (PAGE-284). Resume, load and
reconstruction are decided but no path executes them for plan nodes yet, so
the view reports them as unavailable instead of offering them.

## Model, effort, workspace

- Requested model and effort come from the frozen plan (`source: "plan"`).
  Confirmed values carry their source: `acp_usage_report` (Claude's
  `_claude/model`, first report only), `acp_config_option` (the selector value
  the adapter confirmed before the prompt) or `adapter_selector` (OpenCode).
  OpenCode's default effort is filled in by Pages and is never shown as
  confirmed. A value nobody reported stays `null`.
- The workspace is the directory the plan preparation assigned to the node.
  Pages resolves it with `realpath`, requires an existing directory inside the
  root it checks against (`checkSessionWorkspace` refuses anything outside,
  also through a link) and reads the Git state from `.git`/`HEAD` (including `gitdir:` pointers of worktrees):
  `branch`, `detached` with the commit, `no_repository` or `unreadable`. No Git
  command and no command of the model runs; no repository path is exposed. It
  is read again at every turn start.

## Usage

Context occupancy and token counts are separate values:

- `contextUsed` and `contextLimit` come only from `usage_update.used` and
  `.size` with source and time; the newest report replaces the one before. A
  zero `used` reads as unknown (Claude reports 0 after an unmeasured
  compaction). Without a limit there is no percentage.
- Except for the Codex plan path described below (PAGE-362), token counts come from `PromptResponse.usage`, per turn. A missing
  count is `null`, never 0; nothing is derived from text length or from
  `used/size`.
- Counting: `per_prompt` reports one prompt; `session_total` reports the
  native session so far (the ACP schema's wording), so a turn is the difference
  to the previous report and a decrease is a reset that counts on its own.
- Sums are kept per provider; different countings are never added up. A sum
  is `isPartial` when a turn lacked a count or the adapter reports partial
  turns, and lists every confirmed model it contains.

| Provider (adapter)                    | Counting                                                   | `inputTokens` contains cache reads                    | Partial turns                     | Context (`used`/`size`)                | Cost                                | Load / resume                  |
| ------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------- | --------------------------------- | -------------------------------------- | ----------------------------------- | ------------------------------ |
| Claude Code (`claude-agent-acp`)      | per prompt                                                 | no; total = input + output + cache read + cache write | no                                | last top-level message, cache included | estimate, process total             | resume (transcript on disk)    |
| Codex (`codex-acp`), plans (PAGE-362) | native cumulative deltas reconciled with ACP prompt deltas | yes                                                   | missing reports marked incomplete | context only, never accounting         | OpenRouter equivalent, subscription | load (replays history), resume |
| OpenCode (native ACP)                 | per prompt                                                 | not verified (`null`)                                 | yes (last model step only)        | reported by the release source         | estimate, session total             | resume                         |

A later surface can show `112k In (3.6m Cache Read) · 1.2k Out` from
`inputTokens`, `cacheReadTokens` and `outputTokens`; for Claude the cache is
not part of the input. Codex plan input includes cache; the remaining providers keep their existing counting.

## Claude plan accounting (PAGE-359)

Claude plans opt into the ACP adapter's `_claude/sdkMessage` extension for
`assistant` and `result` messages. Only model IDs, token counters and message
identities enter the accounting journal. Assistant readings replace the previous
reading of that same message and update the UI live. The authoritative cumulative
`result.modelUsage` reconciles those provisional readings, including subagents,
sidechains and internal calls. The overlapping flat `PromptResponse.usage` is not
added again. When only that response is available it retains the adapter's
verified per-prompt counting. A default all-zero response without native usage is
shown as not reported.

A PostgreSQL session ledger keeps its high watermark and observed identities
across attempts and resumed runs. Ledger, allocated turn counters and the local
owner import acknowledgement commit together. Every loop iteration and retry has
its own attempt; run totals sum all those turns. Missing attempts or token
categories mark a total incomplete.

The public OpenRouter model catalog is fetched without credentials at service
startup and every 24 hours. The last validated catalog survives network failures
in PostgreSQL. Claude IDs are matched by model/version, ignoring deployment dates
and context suffixes; ambiguous or absent matches remain unknown. Administrators
can override a model's Anthropic OpenRouter ID in its connection settings. Each
step freezes its first rates per model, with their catalog retrieval time, for
all its turns. Cache read/write rates fall back to the prompt rate when omitted.
Old rows are not repriced.

The supported Claude connection authenticates through claude.ai, so the run panel
and terminal show token categories and "included in subscription", with the
calculated USD amount. Unknown prices and missing usage have distinct labels.
Agent-account monthly spending adds those exact plan amounts to its existing chat
costs. An optional Claude-plan budget in the agent panel refuses the next Claude
step when that account's calculated UTC calendar-month plan spending reaches its
limit; a blank limit disables it. Other providers keep their existing accounting
and have no new Pages budget.

## Operating limits

- Following and reading never start a process or extend a lease. A retained
  group session stays open until its run ends; after a process exit an
  instruction for it fails with `plan_session_unavailable`.
- Instruction turns run in the process that already holds its slot; they
  start nothing new and need no further capacity.
- A turn alone cannot be cancelled: `AcpSession` ends a turn by ending its
  process, which would end the shared group session, so `cancel("turn")`
  reports `nothing_running` for plan sessions.

## Pages terminal (PAGE-284)

### One way for every provider

`CliSessionExecution` starts every plan node through the ACP driver of its
provider, with the profile of its mode, isolation, the limited unit, the
resource scheduler and the Git access of the ACP path. There is no PTY, no
terminal table and no terminal channel any more: migration 030 drops
`agent_plan_terminals`, `agent_plan_terminal_segments` and
`agent_plan_terminal_inputs`; step reports, acceptance and run status of
older runs stay readable. `agent_plan_runs.manual_input_at` stays as the mark
of older runs.

### History and terminal

`AgentSessionRecorder` stores, besides tool calls, plans and turn ends, the
thoughts of the model (`thought`, where the adapter reports them), the answer
in pieces at most one second apart while it is written, and every successful
`update_step_progress` call as a `progress` event. The console renders all
attempts of the node with `renderTerminal` (`plan-agent-console/terminal-lines.ts`),
a pure function, in one xterm; earlier attempts of the run are read with
`history=only`.

### Input in the running turn

A single node offers its live session for input. `AcpTurnControl` joins an
input to the running turn: an adapter with its steering extension takes it
natively, every other adapter gets its running `session/prompt` cancelled and
the input as the next prompt of the same native session; the turn of the
node ends only with a prompt that ends without waiting input. Strg+C and
Escape interrupt the running prompt; the turn then waits up to five minutes
for the next input and otherwise ends as cancelled. The route checks the
right to run the plan for every input.

### Live progress and usage

`update_step_progress` (operation `run.step.progress`) is bound to run and
node like `report_step_result` and allowed in read-only sessions. It stores
the todo states and the activity per run and node in
`agent_plan_step_progress` (migration 031), so a further attempt of the run
starts from them; `withPlanProgress` projects them into `step.progress`.
PAGE-358 initializes all ticket criteria and Markdown checkboxes, including
node instruction checkboxes, before dispatch. The progress JSON stores the
contract and iteration scope; earlier array-only rows remain readable. A
new stack iteration starts with its current ticket, while pause and recovery
retain completed work and render only open TODOs. Marking a ticket TODO done
also checks its ticket entry through the revision-protected checklist service.
QA-only tasks may be completed with `an die Abschluss-QA übergeben`.
`usage_update` stores the context and the cost (`cost_amount`,
`cost_currency`) of the attempt; the view sums the tokens per turn, attempt
(`totals`) and node (`nodeTotals`).

### The TODO list of the CLI (PAGE-306)

A structured ACP `plan` update is recorded as a `plan` event whose text is
JSON (`{"entries":[{"content","status"}]}`, at most 40 entries of 200
characters). `AgentSessionRepository.appendEvents` keeps the newest list of a
batch in `agent_plan_agent_todos` (migration 039), one row per attempt, so
every loop iteration and group member has its own list. An entry has the
position as its identifier, its text, `open`, `active` or `done`, and the time
of its last change; a plan replaces the list, an unchanged entry keeps its
time. Text outside this structure is never read as a TODO.
`withAgentTodos` adds the list as `agentTodos` to every node result of a run,
loop members included, and `read_plan_run` and `read_plan_run_reports` return
it. PAGE-358 includes these entries in the step contract as `A` IDs and
counts them together with ticket and instruction TODOs. Open work is returned
to the same native session for up to three corrective turns, before cleanup
and failure with the remaining TODO texts. Those turns use the existing local
instruction route to keep distinct durable turn IDs within one attempt.
`completionGate` retains its independently versioned ticket-work checks.

### One decision for completion and resume

`backend/service/agents/AgentPlanStepDecision.ts` decides for every provider
how a turn ended (`decidePlanStepCompletion`) and whether and how a failed
attempt continues (`decidePlanStepRetry`, `decidePlanRetryContinuation`); the
restart after a restart of Pages uses the same budget and classes
(`decideAutomaticRestart`, `decideRestartSessionMode`,
`canResumeAfterRestart`). A resumable native session is always continued,
whether or not tool events were recorded.

## Open points

- Remote nodes keep the runner execution (a non-interactive job per node) and
  the event history (decision 2); input into a turn on a remote host needs
  an extension of the runner protocol and its job model.
- Real model turns of Claude Code, Codex and Antigravity in the Pages
  terminal were not part of the PAGE-284 proof; OpenCode ran end to end.
- No MCP tool exposes the service. The plan console (PAGE-86) reads and
  steers it over `agent-api/plan-runs/:runId/steps/:stepId/session` (view and
  one history page after `after`; POST `send` and `cancel`) and follows it over
  `…/session/events`, a server-sent event stream that resumes from
  `Last-Event-ID`. Both take `planId` and `attemptId` in the query.
- Standalone nodes close their session right after their turn; their input
  joins the running turn (PAGE-284). Group members take instructions between
  turns and while a run is paused.
- Resume, load and reconstructed sessions, a recovery API for failed runs and
  turn-only cancellation (`session/cancel`) are not wired for plan nodes.
- Codex's cache counting and OpenCode's are not verified against adapter
  sources in this change.

## Codex plan accounting (PAGE-362, 14 November 2026)

This path applies only to `codex_cli` plan nodes. Claude Code, Pica chat and
other providers retain their existing usage and cost paths. Session control,
TODOs and plan recovery are unchanged. Current managed Codex connections force
ChatGPT authentication (`CodexAcpProfile.ACCOUNT_CONFIGURATION`), so their
calculated costs are subscription equivalents, not additional charges.

### Acquisition, replay and attribution

`CodexThreadUsage` incrementally reads only the assigned connection's
`sessions/.../rollout-...-<threadId>.jsonl` and forwards numeric structured
`event_msg/token_count.info.total_token_usage` counters. It never copies rollout
text into the journal or reads authentication files. Context occupancy and
`last_token_usage` are not added to accounting totals. Cache is part of input;
reasoning is part of output. Missing fields stay null, including an entirely
unreported turn. The reader polls once per second while the session exists and
flushes around prompt completion and closeout; its timer is stopped on close.

Before each prompt, a baseline is stored. The stock adapter's ACP prompt
response is normalized using `totalTokens - outputTokens` as inclusive input,
which also works when the adapter exposes uncached input separately. Native
live reports and the final ACP prompt delta share one cumulative ledger. The
final delta is applied against the **durable** prompt baseline; delayed rollout
entries therefore cannot charge the same work again, even when a resumed
rollout is behind the already persisted counter. An existing thread without an
observable baseline uses only its per-prompt ACP response, avoiding a guessed
absolute total. An absent response remains unreported.

Migration `061_codex_plan_usage.sql` adds thread watermarks, prompt baselines,
per-attempt/model price snapshots and the turn's reasoning and valuation fields.
`CodexPlanUsageRepository` locks the watermark row with `FOR UPDATE`; watermark,
turn counters and valuation commit in the same transaction. Replayed local-owner
outbox records, duplicate totals and older totals cannot claim growth twice.
The local-owner mutation schema preserves native reports and accounting
metadata. Thread watermarks survive attempts and runs. Historical runs are not
silently backfilled or repriced.

### Prices and limits

`OpenRouterPriceService` fetches `https://openrouter.ai/api/v1/models` at startup
and daily, anonymously, with a bounded request timeout. Only validated prices
replace the PostgreSQL cache; errors leave the last good catalog available to
new calculations without network access. Each attempt/model retains its selected
model ID, catalog timestamp and all four rates, including an unknown selection.
Later catalog or administrator mapping changes do not reprice recorded work.

Automatic resolution accepts exact OpenAI IDs and unambiguous dated variants;
ambiguous or missing matches remain unknown. Administrators can enter one
`Codex model = OpenRouter ID` mapping per line in the existing connection form.
Unchanged mappings are omitted on save to preserve concurrent administrator
edits. Invalid or duplicate mappings are rejected server-side.

The formula in USD is:

`(input - cache) * prompt + cache * input_cache_read +
(output - reasoning) * completion + reasoning * internal_reasoning`.

Absent cache/reasoning rates fall back to prompt/completion. Absent breakdowns
use the corresponding base rate without inventing a reported count. Unknown
prices remain null. Run panel and console show all four kinds, `im Abo` with
the equivalent USD amount, `Preis unbekannt`, or `nicht gemeldet`. An incomplete
run total is marked explicitly. The run projection reads every persisted
attempt, including replaced retries, and every loop iteration; its step sums
and run sum use the same rows. The mounted panel polls the authorized session
projection every two seconds and releases its timer on unmount.

The optional `run.monthlyCostLimitUsd` is specific to Codex and defaults to
unlimited. It sums the same persisted equivalent USD amounts per agent and UTC
calendar month and refuses further Codex requests at the limit. It does not
cancel a request already executing. Unknown costs are not fabricated as zero
valuations; only known amounts contribute to the numeric budget sum.

### Local evidence and limits

The PAGE-362 functional tests use mocked filesystem, HTTP and SQL boundaries;
no real MCP process, provider, database or server is started. They cover native
field parsing, partial lines, live polling and cleanup, prompt normalization,
thread deltas and replay, delayed native records, durable resumed baselines,
transaction rollback, immutable prices, offline refresh retention, automatic and
manual model mapping, all loop iterations, missing usage, subscription display,
live run-panel updates, mapping form submission and monthly limits. Existing
Claude usage/session tests and affected connection/panel tests provide focused
regression checks. Exact commands and final results are recorded below and in the ticket
step report for this iteration.

A comparison against a **real Codex thread/provider run is unconfirmed and was
not performed**. No validation plan, disposable Pages/PostgreSQL instance,
provider call, D-Bus or namespace changes were required or attempted. No shared
server, `/opt/pages`, port 3000, `~/.pages`, live database, credentials or Session
1–4 plans were used for validation. No temporary runtime data or provider
processes were created. All test-owned timers and processes ended.

Lint, Check, Typecheck, Build, format verification, full suites and Coverage:
**an die Abschluss-QA übergeben**; none was run as an acceptance gate here.

Protocol references used for source inspection (no model execution):
[Codex token protocol](https://github.com/openai/codex/blob/main/codex-rs/protocol/src/protocol.rs),
[official codex-acp package 2.2.2](https://www.npmjs.com/package/@agentclientprotocol/codex-acp/v/2.2.2),
[OpenRouter models API](https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties).

Final focused validation of this iteration (exit 0 for each command):

```sh
pnpm exec vitest run --config vitest.backend.config.ts --coverage.enabled=false tests/backend/backend/service/agents/page362-codex-usage.unit.test.ts tests/backend/backend/service/agents/page362-codex-persistence.unit.test.ts tests/backend/backend/service/agents/page362-codex-thread.unit.test.ts tests/backend/backend/service/agents/page85-session-usage.unit.test.ts tests/backend/backend/service/agents/page85-session-service.unit.test.ts tests/backend/backend/agents/agent-configuration-input.unit.test.ts
# 6 files, 73 tests passed

pnpm exec vitest run --config vitest.frontend.config.ts --coverage.enabled=false tests/frontend/app/components/agents/plans/page362-codex-usage.unit.test.tsx tests/frontend/app/components/settings/agents/use-agent-form.unit.test.tsx tests/frontend/app/components/settings/agents/agent-form-fields.unit.test.tsx tests/frontend/app/components/agents/plans/plan-panel-details.unit.test.tsx
# 4 files, 41 tests passed
```

| Todo | Local proof                                                                                                                                                                                                              |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| T1   | `page362-codex-usage`: native fields and ACP normalization; `page362-codex-persistence`: recorder and local-owner schema; Frontend `page362-codex-usage`: all token kinds.                                               |
| T2   | `page362-codex-persistence`: multiple turns, duplicate totals, repeated outbox receipts, resumed/stale baselines, delayed native records and rollback. Cache/Reasoning subsets are priced once in `page362-codex-usage`. |
| T3   | `page362-codex-usage`: two actual loop iterations, replaced retries, per-step totals and whole-run totals, including incomplete sums.                                                                                    |
| T4   | Backend calculation and frozen-price tests plus Frontend subscription-equivalent display and hint.                                                                                                                       |
| T5   | Mocked startup/daily HTTP refresh retains the last good catalog offline; persistence tests calculate from the saved catalog and preserve frozen snapshots after changes.                                                 |
| T6   | Backend automatic/ambiguous/manual mapping tests; Frontend field and hook submission tests cover editing, clearing and omitting unchanged mappings. Existing administrator authorization protects the connection write.  |
| T7   | Null prompt/report tests, stale-total/no-fabricated-zero regression and Frontend `nicht gemeldet`/incomplete-total assertions.                                                                                           |
| T8   | Mocked native live polling, recorder updates before prompt completion, Frontend polling while running, and the monthly limit using persisted equivalents.                                                                |
| T9   | This documentation, explicitly unconfirmed real-provider comparison, exited unit-test processes and released test timers; no temporary provider/server/database data was created.                                        |
