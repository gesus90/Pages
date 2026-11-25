# PageAgentCLI sessions

PageAgentCLI is the controlled interface to the session of a plan node. Every
local plan node runs over ACP, whether Claude Code, Codex,
OpenCode or Antigravity, and the plan console shows its stored ACP history in
the Pages terminal (section "Pages terminal" below). The former PTY terminals
are removed. It is no system shell: input reaches only the session
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
instructions stay apart. Older records have no `attemptId`; their
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

The text of a tool event is the title, then marker lines and the command and
output: `@kind <kind>`, `@call <identity>`, `@tool <name>` (the tool name of
the adapter, such as `Bash` or `mcp__pages__read_ticket`, reported by Claude
Code in `_meta.claudeCode.toolName`; codex-acp names an MCP call only in its
title `mcp.server.tool` and wraps its input as `{ server, tool, arguments }`,
so the recorder names it `mcp__server__tool` and describes it by its
arguments), `@about <description>` (the short description of the call: the
`description` an agent gave its command, else the ticket, path or query a JSON
input names), `@exit <code>` only when the adapter reported a numeric exit
code, in `rawOutput` or, for a codex-acp terminal command, in
`_meta.terminal_exit` (a completed call alone is no exit code 0; the terminal
shows the code only for a failure or a code other than 0), `@limited` when the output was cut to its stored limit of 3,000
characters, then `$ <first line of the command or path>` and the output; every
line after the title is optional. The identity is the one the provider gave the call (the ACP
`toolCallId`, the `tool_use_id` of Claude, the item ID of Codex) as one line
without blanks or control characters, at most 200 characters. The Pages
terminal joins the start and the end of a call by the identity within the same
turn, so overlapping calls and calls with the same name keep their own results,
never by an equal title or the order of arrival. A runner splits a long result
into several events and repeats the title and the identity line in each; the
terminal appends the parts, and a failure is never turned into a success by a
later part. Events recorded before identities were kept have no `@call` line:
such a result pairs only with the one running call of its title and otherwise
stands alone, never with the oldest running call. A Claude Code compaction (a
tool call with `_meta.claudeCode.toolName` `compact`) makes the context
occupancy unknown until the next `usage_update`.

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
single node takes input in its running turn. Resume, load and
reconstruction are decided but no path executes them for plan nodes yet, so
the view reports them as unavailable instead of offering them.

## Model, effort, workspace

- Requested model and effort come from the frozen plan (`source: "plan"`).
  Confirmed values carry their source: `acp_usage_report` (Claude's
  `_claude/model`, first report only), `acp_config_option` (the selector value
  the adapter confirmed before the prompt), `adapter_selector` (OpenCode) or
  `cli_stream_event` (the model the Claude CLI of a runner named in its `init`
  event and its top-level answers). The CLI echoes no effort, so a runner's
  `--effort` stays requested and is never shown as confirmed.
  OpenCode's default effort is filled in by Pages and is never shown as
  confirmed. A value nobody reported stays `null`.
- The workspace is the directory the plan preparation assigned to the node.
  Pages resolves it with `realpath`, requires an existing directory inside the
  root it checks against (`checkSessionWorkspace` refuses anything outside,
  also through a link) and reads the Git state from `.git`/`HEAD` (including `gitdir:` pointers of worktrees):
  `branch`, `detached` with the commit, `no_repository` or `unreadable`. No Git
  command and no command of the model runs; no repository path is exposed. It
  is read again at every turn start. The terminal uses that snapshot for Git
  state. The prepared branch of a workspace on the Pages host is available
  for attempts without a Git snapshot. The assigned workplace comes from the
  attempt's execution target or working directory.

## Usage

Context occupancy and token counts are separate values:

- ACP emits `contextUsed` and `contextLimit` through `usage_update.used` and
  `.size`. The latest reported value of each field stays for that model and
  attempt. Claude's zero after an unmeasured compaction leaves the previous
  occupancy in place. The runner uses the ACP session and its confirmed
  selector to attribute Antigravity, OpenCode and OpenRouter readings.
- A Claude Code CLI job of a runner sends its own session readings instead of
  `usage_update`, kept apart from its token counters: `cli_assistant_usage` is
  input, output, cache read and cache write of the latest top-level answer
  (no subagent, no `<synthetic>` banner; a missing counter leaves it unknown),
  the limit is `contextWindow` of exactly that model in the CLI's `result`.
  After `compact_boundary` the occupancy is the count the compaction kept,
  and the window stays (`cli_compact_boundary`). Another model drops both
  values. A reading without a measurement, also a compaction without a kept
  count, keeps the last valid one of the same model, also after the end, on
  reopening and into the next turn; a reading older than the stored one
  changes nothing. Before the job starts, the runner asks the CLI for the
  window of the job's model, so the first reading, sent with `system`
  `init`, names the window with no occupancy yet; the `result` at the end of
  a turn replaces it. The
  `stream_event` `message_delta`
  of an answer completes the reading of its `assistant` event, which holds the
  output tokens counted while the answer was still streaming.
- Every new attempt starts with empty context readings. The sidebar refreshes
  the selected attempt's view after activity, at most once per 1.5 seconds.
  The same "Kontext" block serves all six providers and shows "used /
  window" with the bar below: a known window without a reading yet stands as
  `0 / window` with an empty bar; an unknown window keeps the occupancy and
  shows the shared placeholder ("unbekannt") as its denominator, without a
  bar or a percentage; without both values only the placeholder stands.
  Reopening reads the last stored values of that attempt, also after its end.
- A Codex CLI job of a runner sends the same session readings with the
  source `codex_token_count`: the occupancy and window of the latest
  `token_count` in the rollout of its thread, the model of its
  `turn_context` (see "Measured source of the context of a Codex CLI job").
  The summed tokens of `turn.completed` stay token counters; the same rollout
  names them while the turn runs (see "Token counts of a Codex CLI job while
  its turn runs").
- The token counters of a Claude Code CLI job are the sum of the answers of
  its turn, each answer counted once with its final counters (see "Token
  counts of a Claude Code CLI job while its turn runs").
- Except for the Codex plan path described below, token counts come from `PromptResponse.usage`, per turn. A missing
  count is `null`, never 0; nothing is derived from text length or from
  `used/size`.
- Counting: `per_prompt` reports one prompt; `session_total` reports the
  native session so far (the ACP schema's wording), so a turn is the difference
  to the previous report and a decrease is a reset that counts on its own.
- Sums are kept per provider; different countings are never added up. A sum
  is `isPartial` when a turn lacked a count or the adapter reports partial
  turns, and lists every confirmed model it contains.
- OpenCode additionally reads its native SQLite session and child sessions.
  Each assistant message ID has one durable owner across turns and retries.
  Updated counters replace that message. Step and run projections use these
  native message totals, including reasoning and cache. A row whose model
  step has reported nothing yet is no message: OpenCode writes it with every
  count at 0 when the step starts and measures only at its end.
  Free models cost zero; other models use the saved daily OpenRouter catalogue,
  an administrator's model ID mapping where present, then native message cost.
  Each message keeps the catalogue timestamp used for its price.

| Provider (adapter)               | Counting                                                   | `inputTokens` contains cache reads                    | Partial turns                      | Context (`used`/`size`)                | Cost                                | Load / resume                  |
| -------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------- | ---------------------------------- | -------------------------------------- | ----------------------------------- | ------------------------------ |
| Claude Code (`claude-agent-acp`) | per prompt                                                 | no; total = input + output + cache read + cache write | no                                 | last top-level message, cache included | estimate, process total             | resume (transcript on disk)    |
| Codex (`codex-acp`), plans       | native cumulative deltas reconciled with ACP prompt deltas | yes                                                   | missing reports marked incomplete  | context only, never accounting         | OpenRouter equivalent, subscription | load (replays history), resume |
| Codex CLI job of a runner        | thread sum without the sum before the job                  | yes                                                   | interim reading of a running turn  | `token_count` of the rollout           | OpenRouter equivalent, subscription | `codex exec resume`            |
| Claude Code CLI job of a runner  | answers of the turn; session totals of the result as delta | no; total = input + output + cache read + cache write | interim reading of a running turn  | last top-level answer, cache included  | OpenRouter equivalent, subscription | `claude -p --resume`           |
| OpenCode (native ACP)            | per prompt; every model step as its own native message     | prompt: not verified (`null`); native message: no     | prompt: yes (last model step only) | `used`/`size` of `usage_update`        | free, catalog estimate or reported  | resume                         |
| OpenCode job of a runner         | every model step as its own native message                 | no; total adds reasoning, cache read and cache write  | prompt: yes (last model step only) | `used`/`size` of `usage_update`        | cost OpenCode reported per step     | resume                         |
| Antigravity (`agy acp`)          | per prompt, summed over the prompt's model calls           | no; total = input + cache read + output               | no                                 | `used`/`size` of each `usage_update`   | none reported; OpenRouter estimate  | targeted session resume        |

A later surface can show `112k In (3.6m Cache Read) · 1.2k Out` from
`inputTokens`, `cacheReadTokens` and `outputTokens`; for Claude the cache is
not part of the input. Codex plan input includes cache; the remaining providers keep their existing counting.

### Session usage of an Antigravity attempt

`agy acp` answers each `session/prompt` with `usage` carrying `inputTokens`,
`cachedReadTokens`, `cachedWriteTokens`, `outputTokens`, `thoughtTokens` and
`totalTokens`. The counts are the sum of all model calls of that prompt; the
next prompt of the same native session reports only its own calls. The input
leaves out the cache reads, and `totalTokens` is input + cache reads + output.
Measured on 21.11.2026 with `gemini-4-hydrogen` (reasoning `low`): one prompt
with two model calls reported input 31,092, cache read 26,633, cache write 0,
output 196, thought 127 and total 57,921; the CLI's own conversation
transcript lists input 28,682 + 2,410, cache read 0 + 26,633 and output
181 + 15 for the two calls. In a Pica session the second prompt reported
input 2,906, cache read 33,127 and output 71, exactly its own model call. The
cache write count is a reported 0 and stays 0. Pages stores the turn once per
attempt and turn, also when the runner sends the reading again with its
terminal receipt, and sums the turns of the attempt; a cache count is never
added to the input or the total.

`usage_update` carries only `used` and `size`: the occupancy of the window,
which replaces the previous reading and is never summed. It names no `cost`.
Antigravity therefore delivers no charged amount and no billing status; a
connection signs in with a Google account and its usage counts against that
account's quota. `thoughtTokens` is reported but not stored, because whether
the output count already contains it is not verified. Delegated work of a YOLO
session in another native conversation has not been measured.

#### Counts while a prompt runs

The CLI keeps each ACP session as its own conversation store,
`<Gemini folder>/antigravity-acp/conversations/<session id>.db`, a SQLite file
that the ACP server log names with `Created conversation <session id>`. Its
table `gen_metadata` holds one protobuf row per finished model call. In the
row's message 1, message 4 carries the counts: field 2 input without cache
reads, field 3 output and field 5 cache reads; an absent field is the protobuf
default 0. Message 1 also lists the key `request_id`, which stays the same when
a call is read again. The two calls of the measurement above sum to exactly
the prompt response (28,682 + 2,410 input, 0 + 26,633 cache read, 181 + 15
output). A Gemini 4 Neon conversation of 24.11.2026 has the same layout:
31 calls of one prompt, each with a few thousand input tokens beside more than
100,000 cache reads, so the Neon input also leaves out the cache reads. The
store names no verified cache write count.

The CLI writes the row of a call about 0.1 s after the call's `usage_update`
and its tool call. Measured on 24.11.2026 with `agy acp` 1.5.16 and
`gemini-4-hydrogen` (reasoning `low`): at each `usage_update` of a prompt with
three file reads the row of the call that had just ended was not readable yet,
and appeared within the next quarter second. A reading at `usage_update` alone
therefore always lags one call behind, and a command the model waits for
delays the next update and with it the count by minutes.

A local plan session notes the last row before it sends each prompt. While the
`session/prompt` request is open, Pages reads the rows after that one every
second and at every `usage_update`, read-only and only numbers, sums each call
once by its `request_id` and stores a changed sum under the same attempt and
turn as the prompt's answer later. A history entry of kind `usage` follows each
stored sum, so the open terminal reads the new count within its usual refresh
while the prompt runs. The regular reading ends when the prompt answers, fails
or its connection closes; a failed prompt keeps the calls read until then. The
cache write and the total stay missing in a live count, so its estimate covers
only the reported counts and is marked as partial. When the prompt answers with
`usage`, that sum replaces the live count, because both are stored under the
same attempt and turn; a history entry says whether the answer matches the sum
of the calls. Without `usage` in the answer the calls stand as the turn's
count. Between prompts nothing is read, and the rows of earlier prompts,
attempts and reconnections never count again.

A runner job reads the same store in the process that started `agy acp`
(`scripts/runner/antigravity-usage.mjs`), with the Gemini folder and the
session id of exactly that process. This covers a plan node that runs on a
runner, also on the runner of the Pages host itself. A job sends one prompt.
Before it does, the reader notes the last row: none for a new
conversation, the rows of the earlier prompts for a resumed one. A resumed
conversation whose store cannot be read then reports no live count, because
its earlier rows could not be told apart. While the prompt is open the reader
sums the later rows every second and writes each changed sum as a
`pages.usage` event; the job history turns it into a `usage` event with input,
output and cache reads, and without a cache write count or a total. Pages
stores it under the attempt and turn of the job, where the usage of the
prompt's answer replaces it. A Node.js without `node:sqlite` reads nothing, and
the counts then come with the answer alone.

Measured on a runner job of 24.11.2026 with `agy acp` 1.5.16 and
`gemini-4-neon` (reasoning `xhigh`), one conversation over four prompts, the
later three resumed: the rows of each prompt sum to exactly its answer. The
first prompt reported input 432,944, cache read 15,226,170, output 142,465,
cache write 0 and total 15,801,579, the sum of its 56 rows; the three resumed
prompts reported 14,248 / 1,204,427 / 2,868, then 2,292 / 409,153 / 701 and
2,371 / 411,446 / 407, the sums of the next three, one and one rows. The Neon
input therefore leaves out the cache reads as well, and its total is input +
cache reads + output.

#### Terminal sidebar

The todo list takes the height the other blocks leave, so they stay low. Every
block has 12 px padding above and below and no further margin; a 1 px line
separates two blocks. A row is 28 px high, a row whose value is a badge (model,
reasoning, access, branch) 32 px, and the block "Kontext" 60 px with its
padding, with or without a bar. A todo entry keeps its 28 px line, its 13 px
text, its mark and its tooltip with the full text. A window too low for all
blocks scrolls the whole sidebar, so "Kontext", "Verbrauch" and "Session"
stay reachable. With one bound ticket, an activity line and the report time,
the blocks outside the list take 619 px instead of 739 px before: a sidebar
709 px high shows three entries instead of none, one 880 px high nine instead
of five.

The block "Verbrauch" stands below "Kontext" with three fixed rows of 28 px:
Eingabe, Ausgabe and Cache, each the attempt's sum over its turns. An
Antigravity, a Codex and a Claude Code attempt show it. The row
"Cache" shows only the tokens read from the cache; its hint and its name for a
screen reader read "Aus Cache gelesen". The cache write count has no row and
stays a stored count for checks and the estimate. A count not reported yet
reads "–", a reported 0 reads "0"; the rows stand from the start, so the block
"Session" does not move when counts arrive. While a prompt runs, the rows show
the sum of its finished model calls and follow each further call. Every token
stands in one row only: Codex counts the cache reads within its input, so the
row "Eingabe" of a Codex attempt shows the input without them
(`inputIncludesCache`), while the stored counts stay as Codex reported them.
A Codex attempt without a reported cache count keeps its input as it is and
reads "–" in the row "Cache".

A single cost row "Kosten" stands from the start as well and reads "–" until
an amount can be calculated. The amount is an estimate from the daily
OpenRouter catalogue for exactly the model of the turn. It prices each count a
turn reported with the catalogue rate of that count. A count a turn lacks, as
the cache writes of a running prompt, adds nothing and is never priced as 0;
the estimate is then a partial estimate, and the estimate of the finished turn
replaces it. A reported count above 0 without a catalogue rate, a model the
catalogue does not list, an unverified cache counting or an attempt without
any count leaves no amount, and the hint of the row names the reason. The
reported total stays stored for technical checks and is not shown. Antigravity
reports no charged amount with a billing status, so the row never shows a
provider amount. A Codex attempt shows the amount stored with its turns: the
subscription equivalent `CodexPlanUsageRepository` calculates at the price
frozen for the attempt, cache reads at the cache rate and never twice. It is
a partial estimate while a turn holds an interim reading, and there is no
amount without a turn, with a turn that lacks input or output, or without a
price for its model. A Claude Code attempt shows the amount `accountClaudeUsage`
stored with its turns in the same way (`claudeAttemptUsage`): input, output,
cache reads and cache writes of each model at the catalogue rates frozen for
the attempt. Claude counts the three input kinds apart, so the rows show its
counts unchanged and the cache writes enter only the amount. A turn that
lacks a cache count still has an amount over the counts it reported, marked
as a partial estimate.

The estimate is shown in the currency the account chose under Settings →
Sprache & Region: US dollars until a choice is saved, or euros converted with
the ECB reference rate and marked "ca.". Without a valid rate the US dollar
amount stands with its code "USD". Every amount has exactly two decimals, a 0
as "0,00"; the amount is rounded only for display, after the conversion. The
hint of the value, shown after 1.5 s or at once on keyboard focus, names the
source as "Geschätzt" or "Teilschätzung" with model, price date and original
amount on line 1, and the conversion with rate and ECB day on line 2; a partial
estimate adds that counts not reported yet are left out. The server reads the
ECB rate at most every six hours, an hour after a failed read, keeps the last
valid rate with its working day in `ecb-reference-rate.json` of the Pages data
directory and reuses it on weekends and after failed reads; a rate older than
seven days counts as missing.

### Measured source of the context of a Claude Code CLI job

Measured with Claude Code 2.1.322 and `claude-haiku-5-5` with the output
options of a runner job (`-p --output-format stream-json --verbose
--include-partial-messages`), one `Bash` call and a final answer:

- Occupancy, first reading: the top-level `assistant` event, `message.usage`,
  as `input_tokens` + `cache_read_input_tokens` +
  `cache_creation_input_tokens` + `output_tokens`. It arrives with the first
  answer, before the first tool call ends: 17,399 in a restricted session,
  20,592 with the full tool set of an account.
- Occupancy, afterwards: every further `assistant` event and the
  `message_delta` of its answer: 17,460, then 17,494 at the end of the turn
  of the restricted session. The control request `get_context_usage` after
  the turn reports 17,491 (`totalTokens`), so the stream value is exact
  within a few tokens.
- Window: `result.modelUsage[model].contextWindow`, once at the end of the
  turn: 1,000,000, the same as `maxTokens` of `get_context_usage`. `system`
  `init`, the `stream_event`s and the model list of the `initialize` request
  name no window.

`get_context_usage` answers before the first model call (`maxTokens`
1,000,000 for Haiku 5.5), but only a CLI started with `--input-format
stream-json` reads control requests. A runner job passes its prompt as plain
text, so the runner starts the CLI once more before the job
(`askClaudeContextWindow` in `scripts/runner/cli.mjs`): with the job's
`--model` and environment, the flags of the catalog query (no tools, MCP
servers, hooks or session file) and the single control request
`get_context_usage` with `detail: "summary"`, which the CLI answers from its
own model data without a sign-in, a user message or a model call (about
0.4 seconds with Claude Code 2.1.322). The answer names `model` and
`rawMaxTokens`, for example `claude-sonnet-5-5` and 1,000,000. The reader
(`readClaudeWindow` in `scripts/runner/claude-session.mjs`) applies that
window only to the same model; a suffix such as `[1m]` may differ between
the answers of one selection. An answer with `autocompactSource:
"unknown-model"` is the CLI's default of 200,000 for a model it does not
know and is dropped, as is a missing answer: the window then stays unknown
until the turn's `result` names it.

The path to the sidebar: the runner emits a `usage` event whose text is
`{"session":{"model","context":{"used","limit","source"}}}` for every change;
`persistRunnerSessionReading` stores it on the attempt
(`agent_session_attempts.context_*`) in the transaction that receives the
event; `AgentSessionService.view` returns it as `AgentSessionView.context`
(`contextUsed` / `contextLimit`), and the sidebar shows "used / window".

### Context window at the start, per provider

| Provider                                     | Occupancy                                                | Window before the first reading                                                                               | Checked journal (used / window)                      | Open gap                                                                                                                                                                          |
| -------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code CLI (runner)                     | every top-level answer (`cli_assistant_usage`)           | `get_context_usage` before the job, see above; `result.modelUsage[model].contextWindow` at the end of a turn  | Haiku 5.5 36,912 / 1,000,000                         | A model the CLI does not know has no window until the `result`. Readings stored before this change show running steps without a window, such as Sonnet 5.5 101,724 / unknown.     |
| Codex CLI (runner)                           | rollout `token_count` after every model response         | rollout `task_started.model_context_window` at the start of every turn                                        | `gpt-6.1-terra` 80,105 / 475,000                     | none                                                                                                                                                                              |
| OpenCode (runner, ACP)                       | `usage_update.used`, sent when a turn ends               | the catalog entry of the attempt's model (`limit.context` of `opencode models --verbose`) in the session view | `opencode/deepseek-v4.1-flash-free` 24,581 / 200,000 | The OpenCode inventory of a runner host carries no window, so a connection without a Pages catalog entry for the model shows the placeholder until the first `usage_update.size`. |
| OpenRouter (OpenCode with linked OpenRouter) | `usage_update.used`, sent when a turn ends               | OpenRouter catalog `context_length` of the model                                                              | `openrouter/meta/muse-ember` 135,227 / 1,048,576     | The same as OpenCode for a model the catalog has no `context_length` for.                                                                                                         |
| Z.AI (OpenCode `zai/` models)                | `usage_update.used`, sent when a turn ends               | the catalog entry of the OpenCode model, as for OpenCode                                                      | no Z.AI attempt in the checked journal               | A Z.AI journal comparison is still open; the path is the shared OpenCode one and was replayed with sample readings only.                                                          |
| Antigravity (`agy acp`)                      | `usage_update.used` at session start and after each call | `usage_update.size` with the same report; the Antigravity catalog names no window                             | `gemini-4-hydrogen` 48,449 / 1,048,576               | Until the first `usage_update` the window is unknown; the catalog of `agy acp` states none.                                                                                       |

The values in the journal column come from `agent_session_attempts` of a
snapshot database of 21 November 2026; the sidebar showed the same pair for
each of them.

### Measured source of the context of a Codex CLI job

A Codex node of a plan runs on a runner as `codex exec --json` (originator
`codex_exec`); codex-acp serves only Pica chats. Compared on 18 November 2026
for two real plan jobs on the local runner (runner 1.23.0, Codex CLI 0.166.0,
`gpt-6.2-sol`, effort high, ChatGPT subscription): the first iteration of the
step "Ticket umsetzen" of plan run `8569c5bf-0fda-42bf-be48-e7f659cd18ae`
(attempt `0bf3fc12-7246-412a-9c71-449af4c272a0`, runner job
`03d08176-8d73-43ff-9609-f72117a891c6`, thread
`01a1ef5c-8430-7912-956c-fca16ba8b9a9`, 15:53:00 to 15:56:13 UTC) and its
second iteration (job `669208f0-c27e-46d1-b31d-9398efea83e9`, thread
`01a1ef5f-92d4-7703-90a1-94179083e94f`, 15:56:20 to 15:59:08 UTC). The
provider events are the job's raw history (`history/raw`), the runner
messages its event history (`history/events`) and `result.json`, the session
journal the rollout `$CODEX_HOME/sessions/2026/11/18/rollout-…-<thread>.jsonl`.

| Value          | Where                                                                          | Unit, time                                                                                     | First job                        |
| -------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- | -------------------------------- |
| Window         | rollout `event_msg` `task_started.model_context_window`                        | tokens, at the start of every turn, before the first model call                                | 475,000 at 15:53:00.518          |
| Model          | rollout `turn_context.model`                                                   | at the start of every turn and after a compaction                                              | `gpt-6.2-sol` at 15:53:01.691    |
| Occupancy      | rollout `event_msg` `token_count.info.last_token_usage.total_tokens`           | tokens of the latest model request (input with cache, plus output), after every model response | 21,871 at 15:53:06.505 … 81,996  |
| Window again   | the same `token_count`, `info.model_context_window`                            | tokens, with every reading                                                                     | 475,000                          |
| Cumulative use | rollout `token_count.info.total_token_usage`; `turn.completed.usage` on stdout | tokens of every model request of the thread added up, never context                            | 1,320,487 = runner `totalTokens` |

The second job grew from 22,872 to 78,155 of 475,000; its cumulative use was
976,820, the runner's `totalTokens` of the job. The cumulative count outgrows
the window within one turn, so it never stands for the occupancy. codex-acp
2.7.0 reports the same pair as `usage_update` (`used` =
`tokenUsage.last.totalTokens`, `size` = `modelContextWindow`).

The stdout of `codex exec --json` names no occupancy, no window and no model:
`thread.started`, `turn.started`, `item.*` and `turn.completed` with summed
`usage`. Up to runner 1.23.0 the runner therefore sent only those token
counters, a single `usage` event at the end of the turn, and no session
reading; the attempt kept `context_used` and `context_limit` empty, and the
sidebar showed "Kontext noch nicht gemeldet" for the whole step.

Runner 1.24.0 introduced the rollout reader for the thread `thread.started`
names (`scripts/runner/codex-session.mjs`). Runner 1.25.0 reads new bytes with
every Codex event, once a second while stdout is quiet, and after the process
ends. It sends each distinct model or context update as
`{"session":{"model","context":{"used","limit","source":"codex_token_count"}}}`.
Replayed with the recorded events and rollouts of both jobs, the original
reader sent the window alone
at the start of the turn and then exactly the 21 (first job) and 16 (second
job) distinct pairs of the rollout, in order. `persistRunnerSessionReading`
stores them on Codex attempts as on Claude Code attempts.

Missing and partial values:

- An ephemeral job (`--ephemeral`, a job without continuation) writes no
  rollout, so its context stays "not reported"; the cumulative tokens are
  never used instead.
- A `token_count` without `info` (Codex sends rate limits alone) names no
  usage and keeps the last value. A `task_started` names the window before the
  first model response, so the sidebar can show the window while it waits
  for the first occupancy.
- A compaction (`compacted`, followed by `turn_context`) keeps the window; the
  next `token_count` names what the compaction kept.
- A rollout that cannot be read stops the reader of that job; the job goes on
  and its context stays as last reported.
- Before the first reading the sidebar takes the window from the model's
  catalog entry. Pages stores it for a Codex model as `context_window` ×
  `effective_context_window_percent` / 100 of `codex debug models`, rounded
  down, the same window Codex reports as `model_context_window` (for
  `gpt-6-luna`: 272,000 × 95 % = 258,400), so the window does not change
  with the first reading. Until an occupancy is reported the sidebar shows
  "unknown / window" and no bar; it never counts a missing occupancy as 0.

Reopening, resuming and switching the model:

- The reading is stored on the attempt, so reopening the console shows the
  last value, also after the step ended.
- `codex exec resume` appends to the rollout of the recorded thread (Pica's
  codex-acp sessions show the same: one rollout with up to 53 turns across
  resumes and compactions). The runner skips the existing records before
  the child starts and reports context from records the new attempt writes.
- A `turn_context` with another model drops occupancy and window. The window
  of the new model comes from its `task_started` or `token_count` in the same
  rollout. Pages keeps the last recorded values for the same model and
  session when a later event omits them.

The original checks replayed the recorded jobs through `createLiveHistory` and fed
constructed rollouts for resume, model switch, missing `info`, a line written
in two parts, a line beyond 8 MiB and a job without rollout; the readings then
went through `readRunnerSessionReading`, `persistRunnerSessionReading` and
`attemptContext` with a stand-in database.

### Token counts of a Codex CLI job while its turn runs

Up to runner 1.25.1 a Codex job reported its tokens once, with
`turn.completed`, so the plan terminal showed no counts while the turn ran.
Runner 1.25.2 reads `info.total_token_usage` of every `token_count` with the
rollout reader that reads the context, and sends each changed sum as a `usage`
event with input, output, cache reads, cache writes and total, marked
`"isInterim": true`. The occupancy stays the separate session reading of the
same record; the two are stored apart and never mixed.

- **Counting.** `total_token_usage` and the `usage` of `turn.completed` count
  the whole thread, and `codex exec resume` keeps counting where the last turn
  ended. Before the child starts, the reader keeps the last sum of a resumed
  rollout as the baseline of the job and subtracts it from every later sum,
  also from the counters of `turn.completed` in the `usage` event and in the
  terminal receipt. A thread the job begins has no baseline. A resumed thread
  whose rollout is not found reports no interim count, because its earlier
  tokens could not be told apart, and Codex naming another thread than the
  resumed one ends the baseline. A sum never falls: a sum below the baseline
  started over and counts on its own, and counters of a turn end below the
  latest sum of the rollout are the turn's own and stay as reported.
- **Cache.** Codex counts the cache reads within the input and names the
  cache writes `cache_write_input_tokens`, a reported 0 in every record
  measured. Both are stored as reported, the cache writes as a count for
  checks. A counter a record lacks stays `null` and never becomes 0.
- **End of the turn.** `turn.completed` ends the interim readings; its
  counters replace them under the same attempt and turn and clear the partial
  mark. A turn that fails without `usage` keeps its last interim reading,
  which stays partial. A sum equal to the baseline measured nothing of the
  turn and is not sent. An ephemeral job writes no rollout and reports the
  counters of its turn end alone.
- **Storage and amount.** `persistRunnerStructuredProgress` stores an interim
  reading as a partial turn, and `CodexPlanUsageRepository` values every
  reading at the price frozen for the attempt. The terminal receipt takes the
  same way (`persistRunnerSessionUsage`), so the amount stays after the end
  of the turn; before, the receipt replaced the row without its valuation.
- **View.** `codexAttemptUsage` of the session view sums the Codex turns of
  the selected attempt alone, with the amount, its price date and model, and
  the reason of a missing amount; another attempt of the node never adds to
  it. Every stored reading writes a `usage` history entry, so the open
  terminal reads the view again within its usual refresh, and reopening reads
  the stored row.

Measured on 25 November 2026 with the rollouts of a local test profile
(Codex CLI 0.166.0): all 40,839 `token_count` records of its 2,353 rollouts
name `cache_write_input_tokens`, and no sum falls within a rollout. Of the
133 rollouts written by `codex exec`, seven hold two to five turns, each
continuing the sum of the turn before. One of them, with four turns, was
replayed turn by turn through the output sink of a job (`JobOutput`), the
records before the turn as the existing rollout: the turn of the new thread
sent 8 interim readings, from input 18,576, cache read 12,160 and output 184
to 232,474, 212,608 and 2,070, the 8 sums of the rollout, and the counters of
its end matched the last one. The third turn, resumed at a thread sum of
1,769,197 input tokens, sent 23 interim readings from 79,959, 77,952 and 168
to 2,158,230, 2,136,576 and 3,208; its turn end named the thread sum
3,927,427 and was reported as 2,158,230 in the `usage` event and in the
terminal receipt. Stored on a PostgreSQL test database with a catalogue
price, each reading replaced the row of the turn with its amount, the turn
end cleared the partial mark, and the terminal receipt kept the amount. A
real model turn in the Pages terminal was not part of this check.

### Token counts of a Claude Code CLI job while its turn runs

Up to runner 1.25.2 a Claude job sent, with every `assistant` event, the sum
of the `message.usage` of its answers. That usage is the one of
`message_start`: input, cache reads and cache writes are final, but the output
is the count of the moment the answer began. The session ledger also kept only
the first of these sums: `accountClaudeUsage` ignored every further reading
without an observation, so the plan terminal held the first reading until the
result.

- **Counting.** The CLI reports an answer three times in the output of a
  runner job (`--include-partial-messages`): `stream_event` `message_start`
  with the identity, the model and the counters of the start, `assistant`
  events that repeat those counters for every finished content block, and
  `stream_event` `message_delta` with the final counters and no identity.
  Runner 1.25.3 keeps one reading per answer, takes the highest report of each
  counter and assigns a `message_delta` to the answer its stream (the top
  level, or the call of a subagent) began last. A counter no report named
  stays `null`. Claude's own banners (`<synthetic>`) are not counted.
- **Interim readings.** Every changed sum of the job is a `usage` event with
  input, output, cache reads, cache writes and total, marked
  `"isInterim": true`; an unchanged sum is not sent again. The answers of a
  subagent arrive as `assistant` events only, so their output stays the count
  of their start, and calls the CLI makes on its own are not streamed at all.
  An interim reading therefore is a partial turn. The occupancy stays the
  separate session reading of the same answers.
- **Session ledger.** The job of a plan node adds the sum of one model to each
  interim reading as an observation
  `{kind: "message", id: "live:<job key>:<model>"}`. The ledger keeps one such
  reading per job and model and replaces it with the next one, so the turn's
  allocation follows
  the sum and nothing is added twice. A job without this binding sends the
  sum alone; it replaces the running sum stored for the same attempt and turn.
- **End of the turn.** `result.modelUsage` names the totals per model,
  including subagents and the CLI's own calls, for the whole native session:
  a job that resumed a session with `--resume` reports the tokens of every
  earlier job again. The runner therefore sends them as one observation of
  kind `total`. The ledger takes them as the new total of the session, drops
  the interim readings and gives the turn the difference to the total before,
  so every turn and every attempt holds only its own tokens, also when several
  nodes of a group share one native session. Readings of earlier runners,
  which sent the same totals as readings of one answer, are taken as totals
  as well. The counters without an observation, in the `usage` event and in
  the terminal receipt, are `result.usage` for a resumed job: the job's own
  turn without subagents. A turn that ends without a `result` keeps its last
  interim reading, which stays partial.
- **Further results of one job.** A job whose background task ends after its
  result goes on and reports a further `result`. Its `usage` names only the
  top-level answers since the result before, its `modelUsage` again the whole
  session. With every result the runner settles the answers up to it: the
  answers that follow start interim readings under a new name, and the
  counters without an observation continue from the settled ones.
- **Storage and amount.** `accountClaudeUsage` values every reading at the
  OpenRouter rates frozen for the attempt and each model. A reading without
  an observation never replaces counters the ledger allocated, and the first
  observation replaces a running sum instead of adding to it. The terminal
  receipt of a runner step takes the same way (`persistRunnerSessionUsage`),
  so it no longer replaces the row without its valuation.
- **View.** `claudeAttemptUsage` of the session view sums the Claude turns of
  the selected attempt alone, with the amount, its price date and model, and
  the reason of a missing amount. Every stored reading is a `usage` history
  entry, so the open terminal reads the view again within its usual refresh,
  and reopening reads the stored rows. A local ACP session marks the reading
  of an answer (`_claude/sdkMessage`, `assistant`) as partial as well, until
  the totals of its `result` replace it.

Measured on 25 November 2026 with the job journals of the local runner
(Claude Code 2.1.322, runner 1.25.1), 471 finished Claude jobs:

- In 463 jobs `result.usage` equals the sum of the top-level answers with
  their `message_delta` counters. The other 8 jobs reported a further result
  after a background task had ended; each `usage` matched the top-level
  answers since the result before, and `modelUsage` stayed the running total.
  One of them named input 28, output 15,418, cache read 675,455 and cache
  write 55,601 with its first result and 10, 2,679, 281,176 and 3,828 with
  its second, beside `modelUsage` 38, 18,097, 956,631 and 59,429; replayed,
  the turn stored the first total, followed the eight interim sums after it
  and ended at the second total.
- One turn of `claude-opus-5-5` with 81 answers: the `assistant` events sum
  to input 166, output 1,634, cache read 10,052,567 and cache write 179,876;
  with `message_delta` the output is 50,178, the value of the result.
- Four nodes of one plan run shared a native session (`claude-haiku-5-5`),
  three of them resumed. Their own turns counted input 34, 16, 32 and 26 and
  output 16,677, 9,470, 21,871 and 12,160; `result.modelUsage` named 34, 50,
  82 and 108 input tokens and 16,677, 26,147, 48,018 and 60,178 output
  tokens, the running total of the session. Replayed through the journal of
  1.25.1 and the earlier accounting on a PostgreSQL test database, the four
  attempts stored input 36, 52, 84 and 110: each total again, plus the first
  interim reading. With runner 1.25.3 and the accounting above they store 34,
  16, 32 and 26 with the matching output, cache and amounts, and every interim
  sum was stored on the way (35, 17, 33 and 27 states).
- A turn with 41 answers of subagents (`claude-sonnet-5-5`) held input 156,
  output 14,977, cache read 4,616,959 and cache write 213,026 as its last
  interim reading; the result replaced it with 168, 70,961, 5,097,925 and
  220,529. A turn with a `claude-haiku-5-5` subagent beside
  `claude-opus-5-5` stored both models with their own prices.
- A ticket node that was still running (`claude-fable-5-2`) sent 262 interim
  readings for 131 answers, each stored under its attempt and turn; the last
  one held input 262, output 198,209, cache read 37,304,627 and cache write
  498,455 and a partial estimate of 20.38 USD. The deployed runner had
  reported output 426 for the first 49 of these answers, where their final
  counters sum to 31,902. A ticket node that had been cancelled kept its last
  interim reading as a partial turn.

The amount is an estimate, never a charge: a Claude connection signs in with
a subscription, and the CLI names `total_cost_usd` only with the result, as
its own calculation over the whole session. Two differences to that figure
are known. The catalogue rate `input_cache_write` is the rate of a
five-minute cache entry, while Claude Code 2.1.322 writes one-hour entries
(`cache_creation.ephemeral_1h_input_tokens`), which the catalogue lists
apart as `input_cache_write_1h`: for the turn of 81 answers the CLI named
4.45 USD and the estimate 3.91 USD, the difference being exactly its 179,876
cache writes at the higher rate. And a model with a second price tier for
long prompts (`pricing.overrides`, as `claude-haiku-5-5` above 100,000 prompt
tokens) is priced at its base rates. A real model turn in the Pages terminal
of a deployed server was not part of this check.

### Step usage of an OpenCode attempt while its turn runs

OpenCode answers a prompt with the tokens of its last model step only, and
its `usage_update` comes with the end of the turn. A runner job passed that
answer on, so the plan terminal had no counts while the turn ran and a
fraction of the turn afterwards: of a turn of four steps with input 8,999 the
answer named 1,608. The capability record
[OpenCode ACP](../../../agents/acp/OpenCodeAcpCapabilities.md) holds the
observations.

- **Source.** OpenCode's own session database holds one row per model step of
  the session and of its sub-sessions. The row is written with zeros when the
  step starts and with the measured input, output, reasoning, cache reads,
  cache writes and cost when it ends. `readOpenCodeMessage` and the runner's
  `readOpenCodeStep` return nothing for a row that has not reported, so a
  running step adds no 0.
- **Runner job.** From runner 1.25.4 `opencode-usage.mjs` reads the rows of
  the job's session every second while the prompt is open, read only. The
  database is the one below `XDG_DATA_HOME` of the started process. The rows
  that exist before the prompt belong to earlier prompts of a resumed session
  and are left out. Each finished step is one `usage` event
  `{"openCodeMessage": {…}}` with the IDs of its native message and session,
  the model, the five counts and the cost; a step is sent again only when its
  row changed. The counts of the prompt's answer stay the `usage` event and
  the receipt of the turn, as before.
- **Pages host.** A plan session of the Pages host reads the same rows with
  every update of the session and after the prompt
  (`forwardOpenCodeSessionUsage`). `CliAcpSessionSetup.ts` hands it the
  database of the connection, `opencode/opencode.db` below the connection's
  OpenCode folder, and the data directory of the price list.
- **Storage.** Both ways store a step in `agent_opencode_message_usage` under
  its message ID, with the attempt that reported it first.
  `persistRunnerStructuredProgress` takes the event apart from the token
  counters, so a receipt of the turn never replaces it, drops a usage that
  breaks the contract and leaves a message another attempt owns as it is. A
  repeated batch, the end of the turn and a later attempt therefore never
  count a step twice.
- **Amount.** A step of a runner job keeps the cost OpenCode reported
  (`nativeOpenCodePrice`): the provider amount, or a confirmed zero for a
  model its provider names free (`opencode/…-free`, `openrouter/…:free`). A
  session of the Pages host keeps its pricing: free model, price list, then
  the reported cost.
- **View.** `openCodeAttemptUsage` of the session view sums the steps of the
  selected attempt for the block "Verbrauch": the input without the cache
  reads, the output with the reasoning, the cache reads alone, and the
  amount with `amountSource` (`provider`, `free`, `catalog` or `mixed`).
  Without a finished step every count is `null`. A reported cost of 0 for a
  model that is not free is no amount, because OpenCode also calculates 0
  without a price. While the attempt runs the amount is marked as partial.
  The sums of the turn rows (`totals`) keep the answer of the prompt and are
  not added to it.

Checked on 2026-11-25 with OpenCode 1.19.6 and the free models
`opencode/nemotron-3.5-lightning-free` (three jobs of the runner script over
ACP) and `openrouter/nvidia/nemotron-3.5-lightning:free` (pilot launcher).
The journal events of these jobs were stored through
`persistRunnerStructuredProgress` in an empty PostgreSQL 18 and read back
through `openCodeUsageView`:

| State                             | Eingabe | Ausgabe | Cache  | Kosten | Native sum of the finished steps    |
| --------------------------------- | ------- | ------- | ------ | ------ | ----------------------------------- |
| before the first step ended       | –       | –       | –      | –      | none                                |
| after step 1 (3.0 s)              | 685     | 144     | 4,224  | 0.00   | 685, 53 + 91, 4,224, cost 0         |
| after step 4 (5.0 s)              | 3,821   | 366     | 16,896 | 0.00   | 3,821, 237 + 129, 16,896, cost 0    |
| after step 7, turn ended (7.2 s)  | 8,271   | 603     | 29,568 | 0.00   | 8,271, 387 + 216, 29,568, cost 0    |
| the same events stored again      | 8,271   | 603     | 29,568 | 0.00   | unchanged                           |
| second attempt, session resumed   | 1,552   | 142     | 4,224  | 0.00   | its one step; the first stays 8,271 |
| read again after a new connection | 8,271   | 603     | 29,568 | 0.00   | unchanged                           |

The answer of that prompt named input 1,625, output 35 and cache reads 4,224,
which stayed in its turn row. With made-up steps a reported cost of 0.0123 and
0.02 USD gave 0.01 and then 0.03 as the provider amount, and a cost of 0 or no
cost for a model that is not free gave a dash. A step usage in the browser of
a deployed server, a model with a price and a sub-session were not part of
this check.

### Step usage of an attempt of an OpenRouter connection

A plan node of an OpenRouter connection runs on OpenCode as its private
runtime. Its attempt is named `openrouter`, its model is stored without a
prefix, and OpenCode writes the same rows per model step as for an OpenCode
connection, with `providerID` `openrouter`. The step rows were stored only
for an attempt named `opencode`, and the session view named the step sums
only for that runner, so such an attempt had no counts while its turn ran.

- **Recording.** `recordOpenCodeMessages` takes the steps of every attempt
  that runs on OpenCode. `isOpenCodeRunner` names these runners: `opencode`,
  `openrouter` and a retired provider, whose stored runs ran on OpenCode.
- **View.** The session view names `openCode` and `openCodeAttemptUsage` for
  the same runners, so the block "Verbrauch" of an OpenRouter attempt shows
  the sums of its finished steps. The run sum expects the attempts of
  OpenRouter nodes as well and marks a sum without them as incomplete.
- **Amount.** A model its provider names free (`opencode/…-free`,
  `openrouter/…:free`) is a confirmed zero on the host as in a runner job,
  also without a price list at hand (`isNamedFreeModel`). A model of the
  price list stays an estimate from its rates and the five counts, cache
  writes included; otherwise the cost OpenCode reported stands as the
  provider amount. OpenCode calculates that cost from its own model list; it
  is no amount OpenRouter charged.
- **Apart from it.** The occupancy of the context window stays the reading
  of `usage_update`, and the credit of the OpenRouter account stays with its
  connection. The answer of a prompt stays in the turn row and is no part of
  the step sums.

Checked on 2026-11-25 with OpenCode 1.19.6 and
`openrouter/nvidia/nemotron-3.5-lightning:free`. A request through the pilot
launcher gave one step: no reading while its row held the zeros of its start,
then input 1,988, output 103, reasoning 327, cache reads 0 and cost 0. The
rows of a stored session of 13 steps of the same model were then written into
a session database in the order of their own start and end times and read
through `forwardOpenCodeSessionUsage` into an attempt named `openrouter`,
stored in an empty PostgreSQL 18 through `AgentSessionRepository` and read
back through `openCodeUsageView`. The first attempt took the first eight
steps and a second attempt in a new recorder the remaining five:

| State                                    | Eingabe | Ausgabe | Cache  | Kosten | Native sum of the finished steps       |
| ---------------------------------------- | ------- | ------- | ------ | ------ | -------------------------------------- |
| step 1 started, nothing measured         | –       | –       | –      | –      | none                                   |
| after step 1 (1.7 s)                     | 2,346   | 150     | 4,224  | 0.00   | 2,346, 40 + 110, 4,224, cost 0         |
| after step 3 (4.7 s)                     | 3,405   | 627     | 16,896 | 0.00   | 3,405, 195 + 432, 16,896, cost 0       |
| after step 6 (16.5 s)                    | 6,972   | 2,573   | 38,016 | 0.00   | 6,972, 1,227 + 1,346, 38,016, cost 0   |
| after step 8, turn about to end (21.8 s) | 10,195  | 3,314   | 54,912 | 0.00   | 10,195, 1,686 + 1,628, 54,912, cost 0  |
| the same rows read again                 | 10,195  | 3,314   | 54,912 | 0.00   | unchanged                              |
| after the answer of the prompt           | 10,195  | 3,314   | 54,912 | 0.00   | unchanged                              |
| read again over a new connection         | 10,195  | 3,314   | 54,912 | 0.00   | unchanged                              |
| second attempt, session resumed          | 7,067   | 2,632   | 54,912 | 0.00   | its five steps; the first stays 10,195 |

The answer of the first prompt was given the counts of its last step (input
1,967, cache reads 8,448); it went into the turn row. The node sum over both
attempts held 13 messages with input 17,262, output 2,556, reasoning 3,390
and cache reads 109,824, the sums of the native rows. The three `todowrite`
calls of that session gave the stored work list active, open, open, then
done, done, active, then three times done. The public OpenRouter price list
of that day names 0 for every rate of the model, as the reported cost. A
listed model with a price gave the catalog amount of its five counts, a
missing input count no amount, and a model the list does not name the
reported cost. A step usage in the browser of a deployed server, a fixed
agent node and a ticket node of a real plan run, an OpenRouter model with a
price in a real turn and a sub-session were not part of this check.

### Step usage of an attempt of a Z.AI Coding Plan connection

A connection of the Z.AI Coding Plan is an OpenCode connection that stores a
key of the subscription. Its attempt is named `opencode`, its model keeps the
prefix `zai-coding-plan/`, and OpenCode writes the same rows per model step
with `providerID` `zai-coding-plan`. The steps are stored and summed like
those of every OpenCode attempt; what differs is the amount. The capability
record [OpenCode ACP](../../../agents/acp/OpenCodeAcpCapabilities.md) holds
the observations.

- **Amount.** OpenCode's model list states a price of 0 for the plan because
  the subscription pays for it, so every step reports a cost of 0. Pages
  stores that cost and shows no amount for it: `openCodeAttemptUsage` names
  the gap `subscription`, "Kosten" keeps the dash, and the hint says that the
  model runs on the subscription of the connection, that the provider reports
  no amount for it and that the usage counts against the quota of the
  subscription. A reported cost above 0 stands as the provider amount.
- **No other price.** `OpenRouterPriceCatalog.calculate` keeps the reported
  cost of such a step and nothing else (`isSubscriptionModel`): a free mark
  of the model catalog is no confirmed zero, and a price ID the connection
  names for the model never prices the subscription at the rates of the
  standard API.
- **Sums of node and run.** `sumOpenCodeUsage` counts a reported cost of 0
  only for a model that is confirmed free, as the attempt does. The sums of a
  node or a run with a step of the plan hold no cost, state `unknown`,
  instead of a known 0.
- **One write per reading.** `recordOpenCodeMessages` stores the changed
  steps of one reading as one write and one `usage` event. An attempt that
  resumes a native session in a new process reads every earlier step at
  once; with a write and an event per step, more than 32 steps overran the
  write queue of the recorder and failed the turn with
  `plan_history_unavailable`.
- **Apart from it.** The quota of the subscription is read for its
  connection and is part of neither block. The occupancy of the context
  window stays the reading of `usage_update`.

Checked on 2026-11-25 with the rows of a plan run of 2026-11-24 in the
session database of this host (run `7847a701`, OpenCode 1.18.34,
`zai-coding-plan/glm-5.3-flash`, effort `high`): two fixed agent nodes of one
group in one native session, attempt `b22a8a2b` with 19 steps and attempt
`0a7a7e91` with 16. The rows were written into a session database of its own
in the order of their start and end times, read through
`forwardOpenCodeSessionUsage` with every change, stored in an empty
PostgreSQL 18.6 through `AgentSessionRepository` and read back through
`openCodeUsageView`. The session was given the adverse settings: a free mark
of the model catalog and a price ID for the model that the price list names.

| State                                              | Eingabe | Ausgabe | Cache     | Kosten | Native sum of the finished steps              |
| -------------------------------------------------- | ------- | ------- | --------- | ------ | --------------------------------------------- |
| step 1 started, nothing measured                   | –       | –       | –         | –      | none                                          |
| after step 1 (9.4 s)                               | 107,252 | 397     | 0         | –      | 107,252, 251 + 146, 0, cost 0                 |
| after step 2 (11.5 s)                              | 116,518 | 480     | 107,200   | –      | 116,518, 303 + 177, 107,200, cost 0           |
| after step 5 (21.2 s)                              | 122,481 | 1,247   | 460,224   | –      | 122,481, 626 + 621, 460,224, cost 0           |
| after step 11 (299.2 s)                            | 126,061 | 3,484   | 1,203,264 | –      | 126,061, 1,509 + 1,975, 1,203,264, cost 0     |
| after step 19, turn about to end (347.5 s)         | 133,943 | 8,072   | 2,240,512 | –      | 133,943, 2,983 + 5,089, 2,240,512, cost 0     |
| after the answer of the prompt                     | 133,943 | 8,072   | 2,240,512 | –      | unchanged                                     |
| next node, same session, after its step 1 (11.2 s) | 135,857 | 435     | 0         | –      | its one step; the first node stays 133,943    |
| next node after step 16, turn ended (99.2 s)       | 177,016 | 5,925   | 2,412,480 | –      | 177,016, 2,371 + 3,554, 2,412,480, cost 0     |
| the same rows read again                           | 177,016 | 5,925   | 2,412,480 | –      | unchanged                                     |
| first node read again over a new connection        | 133,943 | 8,072   | 2,240,512 | –      | unchanged                                     |
| new attempt of the first node, session resumed     | –       | –       | –         | –      | none of its own; 35 earlier steps read again  |
| that attempt after its one step                    | 9,266   | 83      | 107,200   | –      | its one step; the first attempt stays 133,943 |

The stored rows belong to the three attempts with 19, 16 and 1 steps, each
with the reported cost 0. The step of the new attempt was made up from the
counts of step 2, and the attempt ran in a new recorder, as a new process
does. The sidebar rendered from these views in a DOM showed the same counts,
the dash for "Kosten" with the hint of the subscription in German and
English, and "ca. 0,02 €" with the hint of a provider amount for a made-up
reported cost of 0.0246 USD. A request to a model of the plan, a ticket node
with such a model, a step usage in the browser of a deployed server and a
sub-session were not part of this check.

### Codex terminal events for the design reference

Representative events of the same jobs, shortened and cleaned: paths, IDs and
ticket contents are placeholders. Each pair shows the provider event on stdout
and what the runner sends to Pages.

Tool start and result (`command_execution`, 582 of 621 with exit code 0):

```json
{"type":"item.started","item":{"id":"item_1","type":"command_execution","command":"/usr/bin/zsh -lc 'cat AGENTS.md'","aggregated_output":"","exit_code":null,"status":"in_progress"}}
{"type":"item.completed","item":{"id":"item_1","type":"command_execution","command":"/usr/bin/zsh -lc 'cat AGENTS.md'","aggregated_output":"# AGENTS.md\n…","exit_code":0,"status":"completed"}}
```

Runner: `tool_started` and `tool_completed` with the text
`/usr/bin/zsh -lc 'cat AGENTS.md'`, `@call item_1` and the output.

Error of a command (39 of 621, status `failed`, the exit code stays in
`exit_code`):

```json
{
  "type": "item.completed",
  "item": {
    "id": "item_37",
    "type": "command_execution",
    "command": "/usr/bin/zsh -lc 'git status --short && git config --get core.hooksPath'",
    "aggregated_output": "## work/session-branch\n M app/example.tsx\n",
    "exit_code": 1,
    "status": "failed"
  }
}
```

Runner: `tool_failed` with command and output.

MCP call and its result (`mcp_tool_call`; the text of the result is the
tool's answer):

```json
{"type":"item.started","item":{"id":"item_3","type":"mcp_tool_call","server":"pages","tool":"read_ticket","arguments":{"ticketId":"<ticket id>"},"result":null,"error":null,"status":"in_progress"}}
{"type":"item.completed","item":{"id":"item_3","type":"mcp_tool_call","server":"pages","tool":"read_ticket","arguments":{"ticketId":"<ticket id>"},"result":{"content":[{"type":"text","text":"{\"apiVersion\":\"1\",\"result\":{\"key\":\"<ticket key>\",…}}"}],"structured_content":null},"error":null,"status":"completed"}}
```

Runner: `tool_started` and `tool_completed` with the text `pages / read_ticket`;
arguments and result are not passed on.

Error of an MCP call (8 of 140): Codex sets `status` to `failed`, while
`error` stays `null` and the cause is the text of the result:

```json
{
  "type": "item.completed",
  "item": {
    "id": "item_11",
    "type": "mcp_tool_call",
    "server": "pages",
    "tool": "update_step_progress",
    "arguments": { "todos": [], "activity": "<activity>" },
    "result": {
      "content": [
        {
          "type": "text",
          "text": "{\"isError\":true,\"code\":\"INVALID_REQUEST\",\"details\":{\"problems\":[\"todos: Too small: expected array to have >=1 items\"]}}"
        }
      ],
      "structured_content": null
    },
    "error": null,
    "status": "failed"
  }
}
```

Runner: `tool_failed` with the text `pages / update_step_progress`.

To-dos: none of the 30 Codex jobs on this runner sent a Codex `todo_list`
item; a plan step reports its to-dos through the Pages tool
`update_step_progress`:

```json
{
  "type": "item.completed",
  "item": {
    "id": "item_7",
    "type": "mcp_tool_call",
    "server": "pages",
    "tool": "update_step_progress",
    "arguments": {
      "todos": [{ "id": "T1", "status": "active" }],
      "activity": "<activity>"
    },
    "result": {
      "content": [
        {
          "type": "text",
          "text": "{\"apiVersion\":\"1\",\"result\":{\"todos\":[{\"id\":\"T1\",\"status\":\"active\"},{\"id\":\"T2\",\"status\":\"open\"}]}}"
        }
      ],
      "structured_content": null
    },
    "error": null,
    "status": "completed"
  }
}
```

A `todo_list` item (`{"type":"todo_list","items":[{"text","completed"}]}`)
would reach Pages as a `plan` event with `pending` and `completed` entries.

File change (34) and web search (1):

```json
{"type":"item.completed","item":{"id":"item_31","type":"file_change","changes":[{"path":"/workspace/app/example.tsx","kind":"update"}],"status":"completed"}}
{"type":"item.completed","item":{"id":"<search id>","type":"web_search","query":"<query>","action":{"type":"search","query":"<query>"},"results":[…]}}
```

Runner: `tool_completed` with `update: /workspace/app/example.tsx`, or the
query.

Turn end (one per job; the counts are summed over every model request):

```json
{
  "type": "turn.completed",
  "usage": {
    "input_tokens": 1314089,
    "cached_input_tokens": 1243776,
    "cache_write_input_tokens": 0,
    "output_tokens": 6398,
    "reasoning_output_tokens": 1949
  }
}
```

Runner: `usage` with `inputTokens`, `outputTokens`, `cacheReadTokens` and
`totalTokens`; `status` "Agent started" for `turn.started`. A `turn.failed`
or `error` event becomes an `error` event with its message; none occurred in
these jobs.

## Claude plan accounting

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

A Claude Code CLI job of a runner reaches the same ledger: the sum of its
answers per model while the turn runs, the totals of its result at the end
(see "Token counts of a Claude Code CLI job while its turn runs").

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

## Pages terminal

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

Every line stands in a text column behind a time column of 80 px (ten
columns). The time is `HH:MM:SS` on a 24-hour clock in the language of the
app, never in the language of the browser; the start line of an attempt
carries `HH:MM`. A tool call is `▸`, its name in bold and its description:
the `@about` description of the call, else the first line of its command. An
MCP name `mcp__server__tool` reads `server · tool`. Its result stands on its
own line below: `✓` with the lines and the duration, or `✕` with the exit
code, the lines and the duration; calls that overlap in time repeat the tool
name in the result line. An output of three lines or more, and every JSON
result, is never drawn in the history: the result line ends with
`▸ Ausgabe öffnen` or `▸ JSON öffnen (48 Zeilen)`, and the opened output
belongs to the call joined by its identity.

### Input in the running turn

A single node offers its live session for input. `AcpTurnControl` joins an
input to the running turn: an adapter with its steering extension takes it
natively, every other adapter gets its running `session/prompt` cancelled and
the input as the next prompt of the same native session; the turn of the
node ends only with a prompt that ends without waiting input. Strg+C and
Escape interrupt the running prompt; the turn then waits up to five minutes
for the next input and otherwise ends as cancelled. The route checks the
right to run the plan for every input. For an adapter whose terminal tool
moves commands into the background (Antigravity), a prompt that ends with
`end_turn` while such a command runs on does not end the turn either: the turn
waits for the command's end and continues with a note naming its exit code
(see [Antigravity ACP](../../../agents/acp/AntigravityAcpCapabilities.md)).
During that wait no prompt runs, so an input is refused as inactive.

### Live progress and usage

`update_step_progress` (operation `run.step.progress`) is bound to run and
node like `report_step_result` and allowed in read-only sessions. It stores
the todo states and the activity per run and node in
`agent_plan_step_progress` (migration 031), so a further attempt of the run
starts from them; `withPlanProgress` projects them into `step.progress`.
Pages initializes all ticket criteria and Markdown checkboxes, including
node instruction checkboxes, before dispatch. The progress JSON stores the
contract and iteration scope; earlier array-only rows remain readable. A
new stack iteration starts with its current ticket, while pause and recovery
retain completed work and render only open TODOs. Marking a ticket TODO done
also checks its ticket entry through the revision-protected checklist service.
QA-only tasks may be completed with `an die Abschluss-QA übergeben`.
`usage_update` stores the context and the cost (`cost_amount`,
`cost_currency`) of the attempt; the view sums the tokens per turn, attempt
(`totals`) and node (`nodeTotals`). OpenCode's `openCode` view reports native
message totals for the node and its full run as messages arrive, and
`openCodeAttemptUsage` those of the selected attempt for the block
"Verbrauch".

### The TODO list of the CLI

A structured ACP `plan` update is recorded as a `plan` event whose text is
JSON (`{"entries":[{"content","status"}]}`, at most 40 entries of 200
characters). `AgentSessionRepository.appendEvents` keeps the newest list of a
batch in `agent_plan_agent_todos` (migration 039), one row per attempt, so
every loop iteration and group member has its own list. An entry has the
position as its identifier, its text, `open`, `active` or `done`, and the time
of its last change; a plan replaces the list, an unchanged entry keeps its
time. Text outside this structure is never read as a TODO.
The `plan` field of `update_step_progress` (at most 40 entries of `text` and
`open`, `active`, `done` or `failed`; `pending`, `in_progress` and `completed`,
the names of the built-in task lists, count as `open`, `active` and `done`) is
the same list for every runner: the
call stores it in the same row of the running attempt, so the newest report of
either way wins and a repeated call never adds entries. The run contract asks
for this list in its own section "Your work list" before the working rules,
with concrete steps instead of the node name: a fixed node derives them from
its instruction and takes over an explicit checklist, a ticket node builds them
per ticket from goal, requirements and acceptance criteria. The list is sent
before the first command with every entry open and the first one in progress,
and again after each finished entry; the closing report is no entry, because
the report check requires every entry done. Claude Code 2.1 offers no built-in
task list in `claude -p`, so its sessions keep the list only in this field.
`agy acp` (Antigravity 1.5.9) offers no task list tool and sends no ACP plan
update, so Antigravity keeps the list only in this field, and a session
without Pages MCP gets no native work list rules. Antigravity lists the tools
of an MCP server only on demand, behind its own tool search, and ignores the
`eagerMcpServers` hint of `session/new`; a model that does not search would
never see `update_step_progress`. Pages therefore marks the tools the run
contract names (ticket and checklist tools, `set_ticket_status`,
`update_step_progress`, `report_step_result` and the swarm tools) in every
`tools/list` answer with `_meta` `antigravity/alwaysLoad`
(`planStepTools`); the rest of the catalog stays on demand. Every choice of
these tools names `type: "string"` beside its `enum` (`stringChoice`): a Gemini
function declaration accepts `enum` only on a string property, and an
Antigravity session had no declaration of `update_step_progress` and
`report_step_result` while their choices were untyped, although it called
marked tools without such a choice. OpenCode
(1.18.34) sent its first list in this field with the names of its own `todowrite` tool, which
Pages refused before it accepted them, so the list arrived one call later;
the `todos` field accepts these names too, and a `priority` copied from
`todowrite` is ignored. OpenCode models, OpenRouter ones included, often keep
the list in `todowrite` itself. Its ACP adapter reports that tool only as tool
calls (title `todowrite`, then `N todos`, kind `other`, the list in `rawInput`
and in the result metadata), so `AgentToolCallEvents` records such a call as
a `plan` event of the attempt, and "Lesend" allows `todowrite`, which changes
nothing on the host. A runner job does the same from runner 1.25.4
(`readOpenCodeTodoList` of `live.mjs`): the call becomes a `plan` event
instead of tool lines, a list the call repeats is sent once, and its
read-only mode allows `todowrite`. A `done` report of an attempt that never
sent a list is refused with the missing list named, so the agent can still
send it; until
then a progress call without `plan` names it in `notice`, and every other
Pages answer of the step carries the same `notice` beside its result
(`PagesAgentApiService.withPendingNotice`), so a model that never calls the
progress tool reads it with its first Pages call. An Antigravity turn with
Pages MCP owes the list also when it closes with a `pages-report` text
instead of `report_step_result`: the assessment after the turn
(`AgentPlanTurnReports.assess`) keeps the obligation `PAGES_PLAN` open
instead of accepting zero of zero todos, so the corrective turn asks the same
session for the missing list. A progress or result call that names
`PAGES_PLAN` itself is not refused for it; only the stored list fulfils it.
The list is stored through
the report slot of the running attempt
(`AgentPlanAgentTodoRepository.saveReported`), so a first report that arrives
before a runner-owned session has written its attempt is not lost, and a
report older than the stored list never replaces it.
The terminal shows the node name and the
bound tickets with their titles (kept in the contract since then) as the
heading of the list, and marks an entry a failed, cancelled or paused step left
in progress as interrupted.
`withAgentTodos` adds the list as `agentTodos` to every node result of a run,
loop members included, and `read_plan_run` and `read_plan_run_reports` return
it. Pages includes these entries in the step contract as `A` IDs and
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
  terminal were not part of the terminal proof; OpenCode ran end to end.
- No MCP tool exposes the service. The plan console reads and
  steers it over `agent-api/plan-runs/:runId/steps/:stepId/session` (view and
  one history page after `after`; POST `send` and `cancel`) and follows it over
  `…/session/events`, a server-sent event stream that resumes from
  `Last-Event-ID`. Both take `planId` and `attemptId` in the query.
- Standalone nodes close their session right after their turn; their input
  joins the running turn. Group members take instructions between
  turns and while a run is paused.
- Resume, load and reconstructed sessions, a recovery API for failed runs and
  turn-only cancellation (`session/cancel`) are not wired for plan nodes.
- Codex's cache counting and OpenCode's are not verified against adapter
  sources in this change. OpenCode's native messages count the input without
  the cache reads, as their `total` shows.
- The step usage of an OpenCode attempt was not compared in the browser of a
  deployed server, neither for a fixed agent node nor for a ticket node, and
  not for a model with a price or a sub-session.
- A model of the Z.AI Coding Plan was not requested for this check: the pilot
  launcher admits no model of `zai-coding-plan`. Its step usage comes from
  the stored rows of fixed agent nodes; a ticket node with such a model and
  the browser of a deployed server are still open.

## Codex plan accounting (14 November 2026)

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
prices remain null. The run projection retains the accounting and marks
incomplete totals. In the terminal, every provider uses the same context
section and the same session rows for runtime, model, reasoning, access,
branch, workplace and restarts. The run projection reads every persisted
attempt, including replaced retries, and every loop iteration; its step sums
and run sum use the same rows. The mounted panel polls the authorized session
projection every two seconds and releases its timer on unmount.

The optional `run.monthlyCostLimitUsd` is specific to Codex and defaults to
unlimited. It sums the same persisted equivalent USD amounts per agent and UTC
calendar month and refuses further Codex requests at the limit. It does not
cancel a request already executing. Unknown costs are not fabricated as zero
valuations; only known amounts contribute to the numeric budget sum.

### Local evidence and limits

The functional tests use mocked filesystem, HTTP and SQL boundaries;
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

The following validation records an earlier revision. The named test files and
frontend configuration were removed and the commands cannot be rerun here.

Final focused validation of that iteration (exit 0 for each command):

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
