# codex-acp capability matrix

What Pica over Codex ACP relies on, checked against the **installed** adapter,
not against its documentation. Checked on 16 October 2026.

| Component                                | Version | Where                                                            |
| ---------------------------------------- | ------- | ---------------------------------------------------------------- |
| `@agentclientprotocol/codex-acp`         | 2.2.2   | global npm package of the server account (`codex-acp --version`) |
| `@openai/codex` bundled with the adapter | 0.160.1 | `node_modules/@openai/codex` of the adapter                      |
| Host `codex` (used through `CODEX_PATH`) | 0.160.0 | `codex --version`; the registry reviews 0.169.0 as next release  |
| `@agentclientprotocol/sdk` in Pages      | 1.7.0   | `node_modules/@agentclientprotocol/sdk`                          |

Pages accepts codex-acp 2.1.1 up to 3.0.0 (`CodexAcpAdapter.ts`). The matrix
describes 2.2.2; another version inside that range must be checked again.

Sources: **live** = `initialize` against the installed binary, without sign-in,
session or model call (protocol 1); **bundle** = reading the installed
`dist/index.js` of the adapter; **binary** = strings of the Codex 0.160 binary.

## Matrix

| Capability                        | Status in 2.2.2                                                                                                                                                                                                                                      | Source       | How Pica uses it                                                                                                                         |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Steering `_session/steering`      | Supported: `initialize` answers `_meta.steering.supported: true`. Request `{sessionId, prompt: ContentBlock[]}`, answer `{outcome}` with `injected`, `startedNewTurn` or `failed`. Steers of one session run one after another.                      | live, bundle | Sent only while Pica's own `session/prompt` runs. `injected` → status `accepted`.                                                        |
| Steer when the turn already ended | The adapter waits for the previous prompt, then starts a **new turn itself** (`startedNewTurn`). That turn has no `session/prompt` response, so its end and its token usage are not reported to the client.                                          | bundle       | Status `followUp`. Pica waits for the end through the thread status below and stores no tokens for that turn (marked as partial).        |
| Thread status                     | `thread/status/changed` of Codex is forwarded to every client as `session_info_update` with `_meta.codex.threadStatus` (`type`: `active`, `idle`, …). The adapter itself treats active → not active as the end of a turn.                            | bundle       | End of a turn the adapter started for a steer. **Not verified live** (no signed-in run was performed); the job deadline is the fallback. |
| Prompt content blocks             | `promptCapabilities: { image: true, embeddedContext: true }`. Text, image (base64), embedded `resource` (text becomes `<context ref=…>`), `resource_link`. **Audio is dropped silently.** An image for a model without image input fails the prompt. | live, bundle | Text and extracted PDF/Office text as `resource`, raster images as `image`; anything not sent is listed with its status.                 |
| `session/new`                     | Supported, with MCP servers and `_meta.mcpStartupAwaitTimeoutMs`.                                                                                                                                                                                    | live, bundle | First job of a conversation.                                                                                                             |
| `session/resume`                  | Supported (`sessionCapabilities.resume`). Needs the same `cwd` as the original session; returns the config options. No history replay.                                                                                                               | live, bundle | Next job of a conversation with the same connection, model, effort and profile.                                                          |
| `session/load`                    | Supported (`loadSession: true`), replays the history as updates.                                                                                                                                                                                     | live, bundle | Not used.                                                                                                                                |
| `session/close`, `session/delete` | Supported. Close cancels a running turn first.                                                                                                                                                                                                       | live, bundle | Close after every job. Delete is not used (see report: Codex rollouts stay in the connection folder).                                    |
| `session/cancel`                  | Supported (notification).                                                                                                                                                                                                                            | bundle       | Not used for steering; stop ends the job process.                                                                                        |
| MCP transports                    | `mcpCapabilities: { http: true, sse: false, acp: false }`; stdio as before. HTTP servers become Codex `url` + `http_headers`.                                                                                                                        | live, bundle | Pica tool bridge as HTTP MCP endpoint `POST /api/v1/pica-bridge`.                                                                        |
| Usage: context                    | `usage_update` with `used` (last turn's total tokens) and `size` (model context window).                                                                                                                                                             | bundle       | Shown as context occupancy; replaced, never summed.                                                                                      |
| Usage: tokens                     | `PromptResponse.usage` per prompt (`inputTokens`, `outputTokens`, `totalTokens`, cached/thought fields); computed by the adapter for that prompt. Also `_meta.quota`.                                                                                | bundle       | Stored per turn (upsert), summed per job.                                                                                                |
| Usage: cost                       | Never sent (`usage_update.cost` absent).                                                                                                                                                                                                             | bundle       | Always "not available", never 0.                                                                                                         |
| Compaction                        | `/compact` command and `compaction_update` only for clients that negotiate it; Codex compacts automatically otherwise.                                                                                                                               | bundle       | Pages `/compact` stays API-only; the Codex session compacts itself.                                                                      |
| Logs of the adapter               | Written only when `APP_SERVER_LOGS` is set (then including prompts). Errors go to stderr.                                                                                                                                                            | bundle       | Pages never passes `APP_SERVER_LOGS` (allowlisted environment).                                                                          |
| Codex feature switches            | `shell_tool`, `unified_exec`, `view_image`, `js_repl`, `code_mode`, `apps`, `plugins`, `multi_agent` exist as feature keys; `web_search` takes `disabled`.                                                                                           | binary       | All off for Pica; web search disabled.                                                                                                   |
| Authentication                    | `authMethods` without sign-in: `api-key` (ChatGPT login hidden by `NO_BROWSER`).                                                                                                                                                                     | live         | Unchanged: the connection's ChatGPT sign-in in its credential folder.                                                                    |

## Subscription quota

The Agents page shows one card per active Codex connection whose usage scope
admits the reader (`CodexQuotaProbe`). The card reads the general Codex quota
of the connection's own ChatGPT sign-in from the Codex app server: `codex
app-server` on standard input and output receives `initialize`, the
notification `initialized` and `account/rateLimits/read` (with
`excludeResetCreditDetails`), never a thread or a turn, so no model is called
and the sign-in is not changed. The input stays open until the answer
arrived. Checked on 18 November 2026 against Codex 0.166.0 with an empty
temporary `CODEX_HOME`: the three lines in one write are answered in order,
and without a sign-in the request fails with "codex account authentication
required to read rate limits", which Pages reads as `signed_out`.

The answer is read as follows. The plan is the `planType` of the general
snapshot: `free`, `go`, `plus`, `pro`, `prolite`, `promax`, `team`, the
business variants (`business`, `self_serve_business_*`), the enterprise
variants (`enterprise`, `enterprise_cbp_*`) and the education variants
(`edu`, `edu_plus`, `edu_pro`) name a subscription; a missing value,
`unknown` or any other value reads "Tarif unbekannt", and "Free" appears only
when the server names it. The general snapshot is `rateLimitsByLimitId.codex`
when present, otherwise `rateLimits` when it names the limit `codex` or names
none while the answer has no per-limit view; a snapshot of another limit is a
model quota and is never shown, nor are credits and reset credits. The windows
are `primary` and then `secondary`; the label comes from `windowDurationMins`
(300 reads "5 Stunden", 10080 "7 Tage", otherwise whole days, hours or
minutes), the rest is 100 minus `usedPercent`, the reset is `resetsAt` (epoch
seconds) in local time. A window the answer lacks is not shown, and an answer
with no window is its own state. The limit statement is
`rateLimitReachedType` or `ordinaryUsageAllowed: false`: the status line reads
"Limit erreicht", with a reset only when exactly one window is used up and
names its reset; it never overwrites the figures of a window, and "0 % übrig"
stands only for a window whose used share reached 100.

The Agents page asks when it opens, on its refresh button and with every push
of its minute stream, and each query re-reads the reader's rights. A connection
has at most one query at a time; requests during it and up to ten seconds
after it share its result. A running Codex session never keeps the query from
running: it runs in a private home with a copy of the connection's `auth.json`
only, and a login it refreshed is written back by an atomic rename only while
the connection's own file is unchanged, so the query cannot invalidate the
sign-in of the session. A failed query leaves the last windows greyed with the
time of the last answer.

## Known gaps

- The end of a turn the adapter started for a steer is detected only through the
  forwarded thread status (not verified live).
- No token usage for such a turn.
- No way for a non-AIR client to delete a Codex thread without a running adapter;
  deleting a conversation leaves the rollout files in the connection folder.
- Image support of the selected model is not known before the prompt; a model
  without image input fails the turn when an image is attached.

## How to check again

Start the adapter with an empty, temporary `CODEX_HOME` and `NO_BROWSER=1`, send
one JSON-RPC line `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1,"clientCapabilities":{}}}`
on its standard input and read `agentCapabilities`, `agentInfo` and `_meta`
from the answer. This needs no sign-in, opens no session and calls no model.
Behaviour beyond `initialize` (steering fallback, thread status, usage) is read
from the adapter's `dist/index.js`.
