# PageAgentCLI sessions (PAGE-85, PAGE-265)

PageAgentCLI is the controlled interface to the session of a plan node. Since
PAGE-265, Claude Code, Codex and OpenCode run as their own interactive CLI in
a pseudo terminal that the plan console shows (section "Terminal sessions"
below); Antigravity stays on ACP. It is no system shell: input reaches only
the CLI of the node, and only from a person who may run the plan. This
document covers the backend; the plan console is its only surface.

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

Today only open group sessions are offered as `live` for ACP instructions;
a terminal session takes input in its terminal while its CLI runs. Resume, load and
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
- Token counts come only from `PromptResponse.usage`, per turn. A missing
  count is `null`, never 0; nothing is derived from text length or from
  `used/size`.
- Counting: `per_prompt` reports one prompt; `session_total` reports the
  native session so far (the ACP schema's wording), so a turn is the difference
  to the previous report and a decrease is a reset that counts on its own.
- Sums are kept per provider; different countings are never added up. A sum
  is `isPartial` when a turn lacked a count or the adapter reports partial
  turns, and lists every confirmed model it contains.

| Provider (adapter)               | Counting   | `inputTokens` contains cache reads                    | Partial turns              | Context (`used`/`size`)                | Cost                    | Load / resume                  |
| -------------------------------- | ---------- | ----------------------------------------------------- | -------------------------- | -------------------------------------- | ----------------------- | ------------------------------ |
| Claude Code (`claude-agent-acp`) | per prompt | no; total = input + output + cache read + cache write | no                         | last top-level message, cache included | estimate, process total | resume (transcript on disk)    |
| Codex (`codex-acp`)              | per prompt | not verified (`null`)                                 | no                         | last turn's total tokens               | not sent                | load (replays history), resume |
| OpenCode (native ACP)            | per prompt | not verified (`null`)                                 | yes (last model step only) | reported by the release source         | estimate, session total | resume                         |

A later surface can show `112k In (3.6m Cache Read) · 1.2k Out` from
`inputTokens`, `cacheReadTokens` and `outputTokens`; for Claude the cache is
not part of the input, for the others the column says it is unknown.

## Operating limits

- Following and reading never start a process or extend a lease. A retained
  group session stays open until its run ends; after a process exit an
  instruction for it fails with `plan_session_unavailable`.
- Instruction turns run in the process that already holds its slot; they
  start nothing new and need no further capacity.
- A turn alone cannot be cancelled: `AcpSession` ends a turn by ending its
  process, which would end the shared group session, so `cancel("turn")`
  reports `nothing_running` for plan sessions.

## Terminal sessions (PAGE-265)

### Providers

| Provider    | Surface                                       | Turn end and usage                                                                         | Open question detected by                                                    |
| ----------- | --------------------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| Claude Code | terminal, full screen (alternate buffer)      | hooks `Stop`/`StopFailure`/`UserPromptSubmit`; transcript: model, tokens, interrupted turn | hooks `PermissionRequest`, `Elicitation`, `Notification` (permission prompt) |
| Codex       | terminal, ordinary output (`--no-alt-screen`) | rollout file: `task_complete`, `turn_aborted`, `token_count`, `turn_context`               | the approval text on the screen                                              |
| OpenCode    | terminal, full screen                         | local interface `GET /event`: `session.idle`, `session.error`, `message.updated`           | `permission.asked`, `question.asked`                                         |
| Antigravity | ACP (decision 2)                              | ACP as before                                                                              | Pages answers every permission request                                       |

Antigravity stays on the adapter `antigravity-acp`: `agy` cannot be isolated
with `GEMINI_HOME`, starts a setup assistant with a consent Pages must not
give, and updates itself. Its history shows the command and output of every
tool call (below).

### Start

`CliSessionExecution` decides per plan node: a Claude Code, Codex or OpenCode
node without `chat` starts `startTerminalSession` (`backend/agents/terminal/`),
everything else ACP. The start keeps the ACP contract: verified sign-in, exact
model and effort, the profile of the mode, the Pages MCP server of the step,
bubblewrap and the limited unit, the resource scheduler and its lease. The ACP
adapter is not needed; unmanaged configuration files are still refused.

| Provider    | Start (`--` arguments abbreviated)                                                                                                                                                                                                                                                                                                                             |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code | `claude --session-id <uuid> --model … --effort … --setting-sources "" --settings <hooks> --mcp-config <pages> --strict-mcp-config` + YOLO `--dangerously-skip-permissions` or "Nur Lesen" `--permission-mode dontAsk --tools Read Glob Grep WebSearch WebFetch`; `AskUserQuestion` removed; `.claude.json` of the private plan home marks onboarding and trust |
| Codex       | `codex --no-alt-screen --no-daemon -C <dir>` + YOLO `--dangerously-bypass-approvals-and-sandbox` or "Nur Lesen" `-a never -s read-only`; model, effort, profile, trust, no update check and the Pages MCP server as `-c` overrides; the credential in `PAGES_MCP_TOKEN`                                                                                        |
| OpenCode    | `opencode --pure --port <free> --hostname 127.0.0.1 -m <model> --prompt … <dir>` with the inline configuration of the ACP driver plus the Pages MCP server, the server password and the `OPENCODE_DISABLE_*` switches (without them the update dialog takes the first key)                                                                                     |

The terminal environment adds `TERM=xterm-256color` and colors. A terminal
session keeps its controlling terminal inside bubblewrap only where the kernel
refuses `TIOCSTI` (`/proc/sys/dev/tty/legacy_tiocsti` = 0); otherwise it stays
a new session and resize signals are sent to the unit and the processes below.
The prompt is the start argument of the CLI; the run record stores the
arguments with `<prompt>` in its place. A further step of a group and a steer
are pasted as one bracketed paste and submitted.

ACP and the terminal never share one process: the hooks, transcripts and the
local interface of each CLI give progress, token counts and turn ends.

### Turns and questions

A reported turn end counts once no new prompt follows within 1.5 s (a CLI may
start a typed prompt as a turn of its own); after an interruption a person has
five minutes to continue, then the turn ends as cancelled. A question that
nobody would answer fails the node at once with `plan_terminal_question`; the
question is stored with the terminal and is the output of the turn. The end of
the CLI during a turn fails the node. Closing hangs the terminal up, ends what
is left of the process group and secures the credentials; the terminal then
takes no input.

### Output, screen and logs (migration 023)

| Table                             | Content                                                                                                                                          |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `agent_plan_terminals`            | One row per CLI process: run, node, provider, state, geometry, full-screen flag, serialized screen and its segment, active member, open question |
| `agent_plan_terminal_segments`    | Redacted output in order, at most 16 KiB each, at most 8 MiB per terminal (older ones are removed)                                               |
| `agent_plan_terminal_inputs`      | Checked inputs until the process of the terminal applied them                                                                                    |
| `agent_plan_runs.manual_input_at` | The run was intervened in manually; it stays after the logs are gone                                                                             |

`TerminalRedactor` masks the exact secrets of the session (MCP credential,
OpenCode server password, provider keys, GitHub token forms) and the patterns
of `sanitizePlanOutput` before anything is stored, shown or answered. It
works on the visible text, so colors and control sequences between the
characters of a secret, a wrap over lines and a cut between chunks do not
stop it; a partial secret at the end of a chunk is held back. The headless
xterm of the server applies every stored segment, answers the queries of the
CLI without a viewer and stores the screen every two seconds.

Every change is announced with PostgreSQL `NOTIFY pages_terminal`, so the
process that runs the CLI (the API, `pages-runs` or a durable local owner) and
the process a viewer is connected to need not be the same.

Retention: `AgentPlanStepRunner.finishPlanRun` removes the terminal logs of a
run that succeeded at once. The logs of a failed or stopped run stay readable
and go with the run when the plan starts its next run (`AgentPlanRunPurge`);
the private session folder lies below `plan-sessions/<run>/`, so a crash
leaves nothing that the next start does not remove.

### Viewing and input

`AgentTerminalService` reads with the rights of the session history (the
executor of the run). Opening returns the screen of a full-screen CLI with
the segments after it, or the last 96 KiB of an ordinary CLI; older pages of
96 KiB follow while the viewer scrolls up. The WebSocket channel
`/agent-api/plan-runs/<run>/steps/<node>/terminal/socket` follows from a
cursor and takes keys and geometry; `…/terminal` takes the multi-line input
(one bracketed paste) and the interruption by POST. Every input requires the
right to run the plan (`canEdit`), a running run and a running CLI, checked on
the server within the last two seconds; any input except a resize marks the
run. A phone shows the terminal read-only and intervenes with the multi-line
input and the interruption.

### ACP history (Antigravity)

`AgentSessionRecorder` keeps title, command (`rawInput`) and output
(`content`, `rawOutput`) of a tool call; a call without a title is named by
its kind, never by its ID. The console shows one entry per finished call.

## Open points

- Remote nodes keep the runner execution (a non-interactive job per node) and
  the event history (decision 2); a terminal on a remote host needs an
  extension of the runner protocol and its job model.
- Bubblewrap around a terminal CLI and real model turns of Claude Code and
  Codex were not proven in the PAGE-265 environment (nested namespaces and
  credentials unavailable); OpenCode ran end to end.
- No MCP tool exposes the service. The plan console (PAGE-86) reads and
  steers it over `agent-api/plan-runs/:runId/steps/:stepId/session` (view and
  one history page after `after`; POST `send` and `cancel`) and follows it over
  `…/session/events`, a server-sent event stream that resumes from
  `Last-Event-ID`. Both take `planId` and `attemptId` in the query.
- Standalone nodes close their session right after their turn, so only group
  members (between turns and while a run is paused) can take instructions.
- Resume, load and reconstructed sessions, a recovery API for failed runs and
  turn-only cancellation (`session/cancel`) are not wired for plan nodes.
- Codex's cache counting and OpenCode's are not verified against adapter
  sources in this change.
