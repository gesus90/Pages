# claude-agent-acp capability matrix

What Pica over Claude Code relies on, checked against the **installed** adapter,
not against its documentation. Checked on 16 October 2026.

| Component                                             | Version | Where                                                                   |
| ----------------------------------------------------- | ------- | ----------------------------------------------------------------------- |
| `@agentclientprotocol/claude-agent-acp`               | 0.90.0  | global npm package of the server account (`claude-agent-acp --version`) |
| `@anthropic-ai/claude-agent-sdk` (adapter)            | 0.3.296 | `node_modules` of the adapter                                           |
| `@agentclientprotocol/sdk` (adapter)                  | 1.8.0   | `node_modules` of the adapter                                           |
| Host `claude` (used through `CLAUDE_CODE_EXECUTABLE`) | 2.1.322 | Pages-managed generation, `claude --version`                            |
| `@agentclientprotocol/sdk` in Pages                   | 1.7.0   | `node_modules/@agentclientprotocol/sdk`                                 |

Pages accepts claude-agent-acp 0.90.x (`ClaudeAcpAdapter.ts`). Another version
must be checked again.

The adapter starts the CLI Pages passes as `CLAUDE_CODE_EXECUTABLE`
(`dist/acp-agent.js`, `pathToClaudeCodeExecutable`), never its bundled one. Its
SDK 0.3.296 bundles Claude Code 2.1.296 but does not check the version of an
external CLI; the contract between them is the SDK's stream-json control
protocol. It was checked again on 10 November 2026 against the Pages-managed
Claude Code 2.1.322, live and without sign-in or prompt: `initialize` reports
claude-agent-acp 0.90.0 and protocol 1; `session/new` started exactly the
managed generation and answered with the model values `default`, `opus`,
`fable`, `sonnet`, `haiku` and the efforts `low` to `max` of that CLI;
`session/close` succeeded. The rows below were taken with 2.1.293.

Sources: **live** = `initialize` against the installed binary with an empty,
temporary `CLAUDE_CONFIG_DIR`, without sign-in, session or model call
(protocol 1); **bundle** = reading the installed `dist/*.js` of the adapter;
**binary** = strings of the Claude Code 2.1.293 binary.

## Matrix

| Capability                        | Status in 0.90.0                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Source         | How Pica uses it                                                                                                                                                     |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Steering `_session/steering`      | Supported: `initialize` answers top-level `_meta.steering.supported: true`. Request `{sessionId, prompt: ContentBlock[], _meta?}`. While a turn is unsettled the prompt is pushed into the same Claude query with priority `now` (`later` while a permission request waits): the current generation is interrupted and the steered message runs in the same `session/prompt`, whose response comes only after a result answered the steer. Answer `{outcome: "injected"}`. | live, bundle   | Sent only while Pica's own `session/prompt` runs and only when `initialize` announced the extension. `injected` → status `accepted`.                                 |
| Steer when the turn already ended | Default: the adapter starts a detached `prompt()` (`startedNewTurn`) whose end the client never learns. With `_meta.steering.idleBehavior: "promptRequired"` it answers `{outcome: "promptRequired", reason: "noRunningTurn"}` and leaves the prompt to the client.                                                                                                                                                                                                        | bundle         | Pages always sends the opt-in. `promptRequired` → status `followUp`; Pages prompts the message once as a regular turn with `session/prompt` and stores its answer.   |
| Prompt content blocks             | `promptCapabilities: { image: true, embeddedContext: true }`. Text; `image` with base64 data (or an http URL); `resource` with text becomes a link plus `<context ref=…>` appended after the prompt; `resource` with a blob is **dropped**; `resource_link` becomes link text; audio is dropped.                                                                                                                                                                           | live, bundle   | Text and extracted PDF/Office text as `resource` (cut after 30,000 characters), PNG/JPEG/GIF/WebP as `image` up to 10 MiB; other files are named with status.        |
| `session/new`                     | Supported; Claude SDK options pass through `_meta.claudeCode.options`.                                                                                                                                                                                                                                                                                                                                                                                                     | live, bundle   | First job of a conversation, with the chat profile options below.                                                                                                    |
| `session/resume`                  | Supported (`sessionCapabilities.resume`). Recreates the Claude query with `resume: <id>`; needs the transcript on disk (`persistSession` true) and the same `cwd`. A missing transcript fails with `resourceNotFound`.                                                                                                                                                                                                                                                     | live, bundle   | Next job of a conversation with the same connection, model, effort and profile `pica-claude-chat-1`; a refused resume starts a new session with the transcript once. |
| `session/load`, `fork`, `list`    | Supported.                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | live           | Not used.                                                                                                                                                            |
| `session/close`, `session/delete` | Supported. Close tears the query down.                                                                                                                                                                                                                                                                                                                                                                                                                                     | live, bundle   | Close after every job. Delete is not used: the transcript stays in the connection folder (see open points of the report).                                            |
| `session/cancel`                  | Supported (notification).                                                                                                                                                                                                                                                                                                                                                                                                                                                  | bundle         | Not used for steering; _Stop_ ends the job process, as for Codex.                                                                                                    |
| MCP transports                    | `mcpCapabilities: { http: true, sse: true }`; stdio as before. HTTP servers become SDK `{type: "http", url, headers}`.                                                                                                                                                                                                                                                                                                                                                     | live, bundle   | Pica tool bridge as HTTP MCP endpoint `POST /api/v1/pica-bridge`, server name `pages`; reachability checked with the local `/mcp` command before the first prompt.   |
| Permission requests               | `session/request_permission` with `toolCall._meta.claudeCode.toolName` (`mcp__pages__<tool>` for bridge tools) and `mcpServer.name`.                                                                                                                                                                                                                                                                                                                                       | bundle         | Chat profile approves only `mcp__pages__*` once; everything else is refused.                                                                                         |
| Built-in tools                    | SDK option `tools: []` disables every built-in tool; `disallowedTools` removes named ones. Without `ToolSearch` Claude Code disables tool search and loads MCP tools directly ("Tool search disabled: ToolSearchTool is not available").                                                                                                                                                                                                                                   | bundle, binary | Chat profile: `tools: []` plus a disallow list of every file, shell, web, delegation, scheduling and tool-search tool.                                               |
| Usage: context                    | `usage_update` with `used` (tokens of the last top-level assistant message, cache included) and `size` (context window; authoritative after the first result, before that inferred from the model name or 200,000). After a compaction `used` is the remaining size or **0** when the CLI named none.                                                                                                                                                                      | bundle         | Shown as reported; `used` 0 or a missing value reads as "not available", never 0.                                                                                    |
| Usage: tokens                     | `PromptResponse.usage`: `inputTokens` (without cache), `outputTokens`, `cachedReadTokens`, `cachedWriteTokens`, `totalTokens` (sum of all four). Also `_meta.quota`.                                                                                                                                                                                                                                                                                                       | bundle         | Stored per turn, summed per job; the total therefore includes cache tokens.                                                                                          |
| Usage: cost                       | `usage_update.cost` = `total_cost_usd` of the Claude SDK, computed by Claude Code from token counts and list prices, cumulative for the adapter process.                                                                                                                                                                                                                                                                                                                   | bundle         | Stored with `isEstimated: true` and shown as "≈ … estimate of the adapter, not a billed amount". With a Claude Max sign-in nothing of it is charged.                 |
| Model report                      | `usage_update._meta["_claude/model"]` names the model of the last assistant message.                                                                                                                                                                                                                                                                                                                                                                                       | bundle         | First report compared with the assigned model; a different model ends the turn (`plan_model_unavailable`).                                                           |
| Subscription quota                | `usage_update._meta["_claude/rateLimit"]` on a rate-limit event (status, window, utilization, reset).                                                                                                                                                                                                                                                                                                                                                                      | bundle         | Stored per connection for the Agents page (see Subscription quota).                                                                                                  |
| Compaction                        | `compaction_update` only for clients that negotiate `session.compaction`; otherwise a tool call titled "Compact conversation" with `_meta.claudeCode.toolName: "compact"`, final `rawOutput` `{trigger, preTokens, postTokens?, durationMs?}`. Claude Code compacts automatically.                                                                                                                                                                                         | bundle         | Journal entry `compaction` (running, completed, failed, token counts as reported), apart from tools, steers and stop. Pages' `/compact` stays an API-model function. |
| Authentication                    | Uses the sign-in of the CLI in `CLAUDE_CONFIG_DIR`. Only the flag `--hide-claude-auth` refuses claude.ai subscriptions; `authMethods` is empty for a client without terminal-auth capability.                                                                                                                                                                                                                                                                              | live, bundle   | Pages never passes the flag; every start checks `claude auth status` for `authMethod: "claude.ai"` and passes no API key (allowlisted environment).                  |
| Thread status                     | Not applicable (codex-acp only).                                                                                                                                                                                                                                                                                                                                                                                                                                           | bundle         | —                                                                                                                                                                    |

## Chat profile (`ClaudeAcpProfile.ts`)

Session mode `default`; options `settingSources: []`, `strictMcpConfig: true`,
`persistSession: true`, `maxTurns: 200`, `tools: []`, the disallow list,
`extraArgs: { "disable-slash-commands": null }`. Environment of the adapter:
`CLAUDE_CODE_EXECUTABLE` (the connection's CLI), model fallback and legacy
remap off, auto memory off, plus the allowlisted CLI environment with
`CLAUDE_CONFIG_DIR` of the connection. The session runs inside bubblewrap with
its working directory read-only; Pica's conversation does not start without
the namespace.

## Known gaps

- A steer that arrives before Pica's first `session/prompt` of a job started
  (while the adapter initializes, configures or checks the bridge) is answered
  in a follow-up turn of its own instead of joining the turn.
- Deleting a conversation leaves the Claude transcript in the connection
  folder (`projects/` below `CLAUDE_CONFIG_DIR`).
- Image support of the selected model is not known before the prompt.
- The context size before the first result of a session may be the adapter's
  inference; Pages cannot tell it from a measured value.

## How to check again

Start the adapter with an empty, temporary `CLAUDE_CONFIG_DIR` and `HOME`, send
one JSON-RPC line `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1,"clientCapabilities":{}}}`
on its standard input and read `agentCapabilities`, `agentInfo` and `_meta`
from the answer. This needs no sign-in, opens no session and calls no model.
Behaviour beyond `initialize` (steering, usage, compaction) is read from the
adapter's `dist/acp-agent.js`, `dist/context-compaction.js` and
`dist/tool-calls/reporters/compaction.js`.

## Plan accounting

The plan profile additionally requests `_meta.claudeCode.emitRawSDKMessages` for
`assistant` and `result`. The adapter sends `_claude/sdkMessage` notifications.
Plans retain only sanitized token observations, deduplicate assistant message IDs
and reconcile them with cumulative `result.modelUsage`; unlike the flat prompt
usage, that model breakdown also includes subagents and internal work. A durable
session watermark prevents charging old readings after resume. Pica's chat usage
path above stays unchanged. Plan prices come from the cached public OpenRouter
catalog, frozen per step/model, with explicit administrator mappings when needed.
See `backend/service/agents/sessions/PageAgentCliSessions.md`.

## Subscription quota

`ClaudeAcpQuota.ts` reads the `five_hour` and `seven_day` windows of each
`_claude/rateLimit` event (`utilization` as a fraction of 1, `resetsAt` in epoch
seconds; one window per event; events arrive only after the first answer of a
session) and the plan of the `_auth/status_update` notification
(`authStatus.account.plan`: `free`, `pro`, `max` or `ultra`; any other or
missing plan is unknown, and `free` counts only when Claude names it).
Every Claude session hands them to `ClaudeQuotaRecorder`, which stores them per
connection; a newer reading replaces an older one, and a window Claude never
reported has no row. The Agents page shows one card per active Claude
connection whose usage scope admits the reader and drops a window once its
reset passed.

The Agents page also asks Claude itself, when it opens, when its refresh button
is pressed and with every push of its minute stream (`ClaudeQuotaProbe`). The
question is the data behind Claude Code's `/usage`: the connection's CLI starts
in stream-json mode and receives only the SDK control requests `initialize` and
`get_usage` (`skip_behaviors: true`), never a user message, so no model is
called. The answer carries `subscription_type` and `rate_limits.five_hour` and
`rate_limits.seven_day`, each with `utilization` in percent (0 to 100) and
`resets_at` as ISO time, straight from the claude.ai usage endpoint. Claude Code
counts that endpoint as non-essential traffic, so this one start sets
`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` to the empty value (any other value,
`0` included, counts as set: with `1` the answer has `rate_limits: null`, with
`0` the call is dropped) and keeps telemetry and error reporting off with
`DISABLE_TELEMETRY=1` and `DISABLE_ERROR_REPORTING=1`. Standard input stays
open until the answer arrived: at its end the CLI shuts down and drops a
running endpoint call. A failed call is answered from the CLI's stored copy of
up to an hour, recognizable by the missing `limits` rows; Pages counts such an
answer as a failed query (`claude_usage_stale`). A copy younger than a minute
is answered without a call and counts as current. A reading names every
current window, so a window it lacks is removed; `rate_limits: null` (no
subscription limits) keeps the stored windows. Checked on 18 November 2026 against Claude Code 2.1.322 with a Max
sign-in: the answer named the plan `max`, a seven-day window and no five-hour
window, and the output held no assistant message.

A connection has at most one such query at a time; requests during it and up
to ten seconds after it share its result. A connection that is not signed in
is not asked and keeps its stored figures. A running native session of the
connection does not keep the query from running, at opening, on the refresh
button and with every push: the query then runs in a private home that holds
only a copy of the connection's `.credentials.json`, so it touches none of the
files the session works with. The providers rotate the refresh token with
every refresh, so a login the query refreshed in its copy is written back by
an atomic rename, but only while the connection's own file is still byte for
byte the copy's origin; a file the session wrote meanwhile stays. The query
therefore cannot invalidate the session's sign-in, and it starts no model
answer. A successful query sets the time of the last answer anew even when
every percentage is unchanged; a failed one leaves the last windows with the
time of the last answer.

Every card carries the outcome of its own query, which its status line shows:
`reported` (Claude answered and at least one window has a value; the time is
that of the answer), `no_windows` (Claude answered without a window),
`failed` (no answer; with the time of the last answer, and earlier windows
stay greyed) and `signed_out` (no confirmed sign-in, or Claude
rejected it with `cli_auth_failed`; the card shows neither plan nor windows
and offers the connection settings instead of another attempt). A query or
push that brings no answer at all marks every card as failed in the browser
while keeping its figures.
