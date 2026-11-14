# Pica chat and models

[Documentation index](README.md). Detailed chat behavior, execution budgets,
CLI differences and protected instructions. For installation, see
[Agent runtime](AgentRuntime.md); for administration, see
[Pica administrator operator](PicaAdminOperator.md).
The tool table below lists the original PAGE-157 core; later catalogs also
include the [Storage interface](StorageApi.md) and administrator tools.

- [Pica native tools (PAGE-157)](#pica-native-tools-page-157)
- [Pica execution budgets (PAGE-103)](#pica-execution-budgets-page-103)
- [Pica over Codex ACP (PAGE-68)](#pica-over-codex-acp-page-68)
- [Pica over Claude Code ACP (PAGE-90)](#pica-over-claude-code-acp-page-90)
- [Pica over native OpenCode ACP (PAGE-91)](#pica-over-native-opencode-acp-page-91)
- [Pica live activity (PAGE-103)](#pica-live-activity-page-103)
- [Pica sessions and conversation context (PAGE-48)](#pica-sessions-and-conversation-context-page-48)
- [Pica quota demo (PAGE-96)](#pica-quota-demo-page-96)
- [Pica's mascot and protected instructions (PAGE-51)](#picas-mascot-and-protected-instructions-page-51)
- [Direct model selection and Pica (PAGE-124)](#direct-model-selection-and-pica-page-124)

## Pica native tools (PAGE-157)

The Pica chat runs Codex CLI, Claude Code, opencode and Antigravity
through ACP; Antigravity reaches the catalog as the one MCP server of its
session, without native tools.
Its native catalog has fixed tools, each on an existing Pages operation with
the current account rights:

| Kind       | Tools                                                                                                                                                                                                                                                                                      |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Reads      | `projects_list`, `projects_read`, `departments_list`, `tickets_search` (in one project; `assignedToMe` for the person's own tickets), `tickets_read`, `assignment_targets_search`, `tags_list`, `milestones_read`, `wiki_search`, `wiki_tree_read`, `wiki_page_read`, `wiki_comments_read` |
| Tickets    | `tickets_create`, `tickets_set_title`, `tickets_set_status`, `tickets_set_description`, `tickets_set_assignee`, `tickets_set_tags`, `tickets_set_departments`, `tickets_set_parent`, `tickets_set_milestone`, `tickets_delete`                                                             |
| Projects   | `projects_create`, `projects_set_name`, `projects_set_description`, `projects_set_status`, `projects_set_dates`                                                                                                                                                                            |
| Milestones | `milestones_create`, `milestones_set_name`, `milestones_set_description`, `milestones_set_status`, `milestones_set_start_at`, `milestones_set_due_at`, `milestones_delete`                                                                                                                 |
| Wiki       | `wiki_page_create`, `wiki_page_set_title`, `wiki_page_set_content`, `wiki_page_move`, `wiki_page_delete`, `wiki_comment_add`, `wiki_comment_edit`, `wiki_comment_resolve`, `wiki_comment_delete`                                                                                           |

Sessions of agent employees (not Pica) additionally get `chats_list`,
`chat_read` and `chat_send` (PAGE-311): an agent reads the chats it takes part
in and sends a message to a chat, person, agent or user group it may assign
tickets to. A message to an agent is answered like one of a person, queued
while the agent is busy; `waitForReply` returns the answer or `pending`. Ten
agent messages in a row without a person pause the conversation until a
person or administrator allows it to go on, and each agent sends at most the
hourly limit of Settings → Agents (30 by default).

There is no generic operation tool and no text-action fallback. A normal
person gets no administration (accounts, roles, connections, instance
settings); an administrator in the active admin mode additionally gets the
administrator catalog described in [Pica administrator
operator](PicaAdminOperator.md) (PAGE-180). `projects.list`, the read
behind `projects_list`, is also an operation of the agent API. Wiki comments
are the only comments Pages has; tickets have none.

Pica acts on user level when the person asks, without a confirmation line or
word (PAGE-68), and names the result. Every call runs through the existing
services with the current rights of the person; a missing right returns
`FORBIDDEN`, which Pica reports. Changes carry the expected old value or
revision wherever the operation checks one, so a concurrent change ends in
`CONFLICT` instead of being overwritten. Tickets, milestones and wiki pages are
archived or moved to the trash on an explicit current request. Typed
confirmation words were removed in PAGE-322; authorization and revision checks
remain. Permanent deletion has its own administration rules. A write that failed is refused with `RETRY_REFUSED` when it
is sent again unchanged in the same turn. A text of a write holds at most
20,000 characters, as much as a tool result can show.

The production composition selects ACP explicitly. `legacy-actions` retains
its earlier text protocol for compatibility tests and never acts as a fallback.
Pages owns transcripts, attachments and existing summaries. Native CLI
sessions manage their own context; `/compact` is unavailable for Pica.

Pica settings offer only usable CLI models. Free opencode Zen models are hidden
because they require opencode's own tools; agent plans keep them. A saved API
choice is retained. Settings propose its exact opencode equivalent only when
provider, model, linked key and reasoning effort match unambiguously; the person
confirms it with Save. Otherwise Pica asks for a new selection and never changes
models silently. OpenAI and Anthropic API keys remain available to other Pages
functions, while Pica uses the Codex and Claude CLI sign-ins.

The z.ai account choice and additive migration rollback are documented in
[z.ai account routing](ZaiAccountType.md).

## Pica execution budgets (PAGE-103)

ACP and legacy actions permit up to **256 actual Pages tool executions
per turn**. Validated calls reserve their place before dispatch, including
failed service calls; rejected schemas, unknown tools and refused repeated
failed writes do not execute a service. Call 257 is refused as `STEP_LIMIT`.
ACP stops the job with the translated limit status and retains its journal.

Injected steering shares the current budget. A separate follow-up gets a fresh
budget at the native prompt boundary, including adapter-started turns whose
first calls arrive before Pages dequeues them. A new message in a resumed
session also starts fresh; the one-time failed-resume fallback keeps the same
turn budget. Rights, abort signals, client-message idempotency and failed-write
retry protection remain in force.

Legacy mode separately bounds model iterations to 258, so malformed actions
cannot create an unbounded loop. Provider retries stay off.

The chat request registry allows **90 minutes per request/job**, with the
existing capacity of 16 and one request per person. This budgets 20 seconds
per model/tool cycle plus 280 seconds for startup and completion. Follow-ups
share the job deadline; steering does not extend it. Explicit shorter Claude
Code/OpenCode agent timeouts still apply; Codex keeps the chat deadline as
before. Provider context limits, bounded history, attachment/result size
limits and resource admission still apply, so 256 calls is a ceiling rather
than a guarantee for arbitrary workloads.

## Pica over Codex ACP (PAGE-68)

When the chat agent under _Settings › Agents_ uses a Codex CLI connection, Pica
answers through `codex-acp` with the same native tools. There is no model choice
in the chat and no fallback to an API model; the assignment is resolved anew
for every new answer, so a change applies from the next message on.

- **Server-side jobs.** Sending stores the message and starts a job on the
  server. Closing the browser, switching tabs or a lost connection does not end
  it; only _Stop_ does. The panel reads the job's journal after its last cursor,
  so returning shows the current state or the finished answer without running
  anything again. _Stop_ keeps what Pica had written in the running turn as its
  answer, marked as stopped (migration 054); a new agent session receives it
  marked as incomplete.
- **Sent once.** Every message carries a client message ID, which stays the
  same when the browser sends the message again unchanged after a failure. A
  conversation stores each ID once (migration 052): a repeat returns the job
  or steer of the first sending; an older message without a replayable ACP
  outcome is refused as already sent. A second Enter or click before the panel updated sends nothing.
- **Steering.** While Pica answers, sending stays possible. The message goes
  into the running turn through `_session/steering` (status _accepted_); a
  message that arrives between turns, or that the adapter no longer takes, is
  answered in a turn of its own (_follow-up_). Statuses: pending, delivered,
  accepted, follow-up, failed.
- **Selected data.** The attachments selected for a message (and for a steer)
  reach Codex as content blocks: text as an embedded resource (cut after
  30,000 characters), raster images up to 10 MiB. Every other type, a cut text
  or a too large image is listed under the message; the snapshot of each
  message is stored once and never changed. Sending waits until every chosen
  file finished uploading. A steer gets its snapshot once Codex took it; a
  steer Codex refused shows as failed, without one.
- **Tools.** Codex reaches Pica's tools only through the MCP endpoint
  `POST /api/v1/pica-bridge`, with a random per-job token held in memory. Each
  call is bound to person, conversation and running turn and is authorized
  again; up to 256 actual tool executions are allowed per agent turn. The shared
  native tools act on the person's current rights without an additional
  confirmation line, as described above. The session stays in read-only
  mode and Pages approves only requests for calls of the tool bridge. The
  session has no shell, file, image, app or web tool, runs read-only inside
  bubblewrap (required) and gets no other MCP server. Models whose Codex
  catalog demands code mode, such as `gpt-6-luna`, call the same tools from
  Codex's `exec` tool; their names then carry the prefix `mcp__pages__`.
- **Sessions.** Each conversation keeps one Codex session, continued with
  `session/resume` while connection, model, effort and profile stay the same
  and no message arrived on another path. The process holds one lease of the
  shared ACP scheduler only while a job runs. Working directories are empty
  folders in `pica-sessions` next to the agent folders.
- **Consumption.** Context occupancy follows the adapter's latest valid
  report in the composer doughnut. Token and cost reports remain in the job
  journal; they are not displayed in the live activity row.

The capability matrix of the installed adapter is in
[backend/agents/acp/CodexAcpCapabilities.md](../backend/agents/acp/CodexAcpCapabilities.md).

## Pica over Claude Code ACP (PAGE-90)

When the chat agent under _Settings › Agents_ uses a Claude Code connection,
Pica answers through `claude-agent-acp` on the same server-side jobs, journal,
steering, attachments and tool bridge as with Codex: jobs run on without the
browser, a message is stored once, steers and selection snapshots keep their
statuses, and the native tools act on user level as described in the PAGE-83
section. This section names what differs.

- **Assignment only.** Connection, model, effort and the permission mode come
  from the assigned chat agent and nothing else: no model default, no fallback
  to Codex, an API model or another process. The mode must be _Read only_,
  because Pica gets nothing but the bridge tools there; an agent stored with
  YOLO or the earlier write mode is refused with a translated explanation
  before the message is stored. The agent's timeout limits the adapter process
  on top of the chat's own deadline. A missing assignment, model, effort,
  adapter or sign-in fails with its own message.
- **Claude Max.** The session uses the claude.ai subscription sign-in of the
  connection (`claude auth login --claudeai`) in its own credential folder;
  every start checks `claude auth status` for it. No API key, token or
  settings file reaches the process, and Pages never passes the adapter's
  `--hide-claude-auth` flag.
- **Steering.** The adapter announces `_session/steering` in `initialize`; Pages
  steers only then. A message sent while Pica's prompt runs interrupts the
  current generation and joins the same turn (_accepted_). A steer that finds
  the turn already ended comes back with `promptRequired`, because Pages asks
  for that, and is answered once in a turn of its own (_follow-up_).
- **Selected data.** Text attachments as embedded resources, PNG/JPEG/GIF/WebP
  images as image blocks, for the message and for steers. The adapter drops
  binary resources, so PDFs and other files are listed as not transferred.
- **Tools.** The session has no built-in tool of Claude Code (`tools: []` plus
  a disallow list), no settings of the user or workspace and no MCP server but
  the bridge. Pages approves only calls of `mcp__pages__*`; the bridge
  authorizes each call again for person, conversation and turn.
- **Sessions.** Each conversation keeps one Claude session, kept on disk in the
  connection's credential folder and continued with `session/resume` under
  the profile `pica-claude-chat-1`.
- **Consumption and compaction.** The journal retains reported context and
  tokens, including cache reads and writes, and marks Claude Code's cost as
  its estimate at list prices (migration 053), never as a billed amount.
  Claude Code compacts its context on its own. The live row hides these
  events; the doughnut reads "not available" until valid occupancy is reported
  again.

The capability matrix of the installed adapter is in
[backend/agents/acp/ClaudeAcpCapabilities.md](../backend/agents/acp/ClaudeAcpCapabilities.md).

## Pica over native OpenCode ACP (PAGE-91)

An OpenCode chat agent starts the installed `opencode acp` directly through
the shared ACP client. Pages verifies the native contract of **1.18.34** before
the prompt. The admin assignment determines the connection, full model ID
(for example `openrouter/nvidia/...:free`) and exact variant. OpenCode is the
runner; its model provider is a separate choice. The connection's key form
explicitly distinguishes OpenCode Console / Zen (`opencode`) from OpenRouter
(`openrouter`) and encrypts new keys with the existing instance cipher. Existing
OpenRouter native credential files keep their exact provider and model IDs. Other credential formats and custom provider
configurations are not imported. No model, provider or API fallback is used.

- **Scope and isolation.** Pica requires _Read only_ workspace access. It uses
  the existing jobs, scheduler, durable leases, connection locks and process
  cleanup. Bubblewrap is required; the chat directory is mounted read-only.
  The managed `pages-pica` mode denies all native tools and permits only
  `pages_*` from the existing authorized tool bridge. No administrator tools,
  shell, file tools, database access or other MCP servers are exposed.
  Project settings, external skills, default plugins, sharing and updates
  are disabled. Global instructions, plugins or configuration in the isolated
  home, and system-managed configuration, block startup. Automatic title and
  summary model calls are disabled; compaction uses the assigned model.
- **Steering gap.** OpenCode 1.18.34 announces no steering contract and returns
  JSON-RPC `-32601` for `_session/steering`. Pages sends no concurrent prompt
  to imitate it. The panel says that an additional message receives its own
  follow-up answer. Its status is `followUp`, never `accepted` or `delivered`.
  The shared conversation queue handles a turn-end race exactly once: the
  current job takes the message, or intake closes and the next job takes it.
  **Real steering remains unsupported by this native server.**
- **Selected content.** The shared upload checks still apply. Text and JSON
  are embedded context, limited to 30,000 characters; PNG, JPEG, GIF and WebP
  use image blocks up to the existing asset limit. Unsupported, unreadable,
  truncated or oversized content is shown under its message. Each message's
  resolved payload is reused unchanged for retries and follow-up turns.
  The native adapter's generic image capability does not guarantee that the
  assigned model supports vision; model refusals remain visible.
- **Sessions.** `session/resume` continues only the same person's chat with
  the same connection, model, variant and profile `pica-opencode-chat-1`.
  Losing or closing the browser leaves the server job running. _Stop_ ends
  it explicitly. A server restart marks interrupted jobs and does not replay
  them. Deleting a Pages conversation removes its Pages mapping, messages
  and attachments; native CLI archives and provider retention are not erased,
  which the deletion panel now states.
- **Consumption.** Context occupancy comes from `usage_update`; absent or
  invalid reports remain unavailable. OpenCode's prompt usage describes the
  last model step of a tool loop, so stored token counts are marked incomplete.
  Its cost is the cumulative native session estimate, recorded as such and
  never added again per job. Migration **055** extends the scheduler's
  provider constraint and retains these usage distinctions. `/compact`
  explicitly refuses native chat agents; OpenCode manages its own context.

The protocol observations and upstream source references are in
[backend/agents/acp/OpenCodeAcpCapabilities.md](../backend/agents/acp/OpenCodeAcpCapabilities.md).
OpenCode plan nodes also use the native ACP entry point; see
[OpenCode plan setup](AgentRuntime.md#opencode-plan-nodes-with-a-console--zen-key-page-66).

## Pica live activity (PAGE-103)

While an ACP job runs, the message list shows one compact row:
the unchanged Pica mascot, three orange dots, a neutral phrase that changes
every 20 seconds, and elapsed wall time. The timer updates once per second
from `ChatJob.createdAt`; before the job acknowledgement it uses the local
send time. Closing and reopening the panel keeps that start; hidden panels need
no timer interval. Reduced-motion preference disables dot animation. The
activity has an accessible status label and the timer does not announce every
second. Tool badges, intermediate answer text, usage and compaction events
remain internal while processing. Final answers appear as ordinary messages;
failed/interrupted jobs keep their journal text visible, and stopped answers
stay stored with their stopped marker.

The attachment caption is removed; uploads, limits and errors are unchanged.
The composer shows exactly one context doughnut, directly before Stop while a
job runs and beside Send when idle. Its existing pointer, touch and keyboard
details remain available. Header and composer share the panel surface without
horizontal borders, and a transparent mask fades the message edges. The outer
panel frame and mascot asset stay unchanged. The launcher uses the panel
surface, shadow, subtle hover/active fills, keyboard focus and an open ring.

## Pica sessions and conversation context (PAGE-48)

In the Pica panel, `/delete` opens a selection of the signed-in person's own
sessions, including a select-all option. The permanent deletion button states
the exact count; no typed confirmation is needed in this panel. Cancelling or
leaving the selection empty deletes nothing. Only the displayed selection is
submitted, in batches of at most 200 IDs. The server checks ownership of every
batch before deleting any of its sessions. Per-session failures remain visible
for a targeted retry; file cleanup failures are distinguished from sessions
that were not deleted. Deleting the active session opens a remaining session or
a new empty chat. If refreshing fails, the panel offers a new-session button.

`/compact` explains that the native CLI manages conversation context. Pica no
longer starts a separate summary model. Previously stored summaries and every
original message remain readable and continue to seed a new native session.

The small context indicator estimates tokens in the bounded conversation history
and saved summary using roughly four characters per token. Its tooltip is
available on pointer hover, keyboard focus and touch, and closes with Escape.
It marks estimates and unavailable values, and shows a model limit and estimated
conversation share when the assigned model's catalog provides that limit. This
is conversation context only: system instructions, new attachments and current
turn action results are excluded.

Session deletion through agent tools also follows the explicit current request
without a typed confirmation word (PAGE-322).

## Pica quota demo (PAGE-96)

Pica's quota panel does not query provider budgets. Agent Plan's provider waits
are separate from this demonstration. To show how Pica reports a used-up quota, `/quota`
starts a simulated state that exists only in the open browser tab and is marked
**Demo** wherever it appears; reloading the page ends it.

- **Quota used up (simulated).** A card above the input names the state and
  the time waited so far as of the last refresh; there is no countdown and no
  reset time. A message sent meanwhile does not reach the server: Pica answers
  with a simulated, unsaved notice and the text stays in the input, so the
  conversation is unchanged.
- **Budget status not available.** The card can switch to the OpenCode case:
  OpenCode reports no budget, missing data is not read as a used-up quota, and
  messages are sent as usual.
- **Refresh and reset.** _Refresh_ updates the waited time; _Reset_ ends the
  demo. Nothing is sent again on its own; sending the message again is the
  person's own action.

## Pica's mascot and protected instructions (PAGE-51)

### Mascot

Pica appears with one graphic: `assets/pica/pica_maskottchen.svg`, the SVG
attached to PAGE-51, taken over byte for byte. `app/components/chat/pica-mascot.tsx`
renders it in the launcher (44 px in the 56 px round button), in the chat header
(36 px), beside Pica's answers and the pending row (28 px) and on the chat
settings card (28 px in the 36 px symbol tile). It keeps its square canvas
(`object-contain`) and is never clipped to a round or rounded frame. The image is
decorative (`alt=""`); the launcher button, the heading and the message label
name Pica for assistive technology. It is imported with `?no-inline`, so the
build emits it as a file of its own that browsers load once, instead of a data
URL in every rendered page.

### Protected `AGENTS.md` and `SOUL.md`

Pica has two instruction files of its own:

- `backend/service/chat/pica/SOUL.md`: identity, tone and style of communication.
- `backend/service/chat/pica/AGENTS.md`: tasks, way of working and binding rules.

They are runtime instructions of Pica, not instructions for coding agents.

**Delivery.** `pnpm run build` copies both files next to the server bundle, to
`build/server/pica/` (the `pages-pica-instructions` plugin in `vite.config.ts`,
server build only). They are not part of `build/client/`, the only directory the
server hands out. Deploy the complete `build/` directory.

**Loading.** `backend/service/chat/PicaInstructionFiles.ts` derives the directory
from the location of the server code: `build/server/pica/` in production, the
source directory in development and tests. Configuration, database, environment
and requests cannot change it. Every Pica message reads both files anew before
the message is stored. The system instruction of the turn starts with `SOUL.md`
and `AGENTS.md`, followed by the optional supplement of the administrator, the
fixed working rules of Pages and the action catalog. The instruction is rebuilt
for every message and is never part of the conversation, so the files apply in
new sessions and after `/compact`, which summarizes only the conversation. Only
the Pica chat loads them. Plan nodes and user agents keep their own instructions. Their `AGENT.md` files, working directories and
configurations stay untouched.

**Protection in the product.** Pages has no function that edits, replaces or
deletes the files: no page, settings field, API route, Agent API or MCP
operation, and no Pica action. _Settings › System › Chat assistant Pica_ keeps
only an optional supplementary instruction in the database. It stands below the
protected files with the note that it cannot override them, and an empty field
removes it. Chat messages, attachments and action results reach the model as
data. Uploads are stored under server-chosen names in `<data>/chat-attachments/`,
a different directory. The loader reads only regular files of at most 64 KiB in
UTF-8. A link, directory or pipe in place of a file is refused, so a link to
another agent's files is never followed.

**Missing or unreadable files.** If a file is missing, unreadable, not a regular
file, larger than 64 KiB, not UTF-8 or empty, the server logs one line with the
path, `missing` or `unreadable` and the reason, never the content:

```text
[pages] A protected instruction file of Pica cannot be used; the chat does not answer. <path> missing ENOENT
```

The reasons are `ENOENT`, `EACCES` (or another file-system code),
`notARegularFile`, `tooLarge`, `notUtf8` and `empty`. The message is neither
stored nor sent to a model. The browser receives HTTP 503 with the code
`instructionsUnavailable`; the panel shows a translated notice and keeps the
typed text. Pages never falls back to other instructions or to another agent's
files. All other functions keep working.

**Product access versus backend change.** In the running product nobody can
change the files, administrators and Pica included. To change Pica's identity
or rules, change the backend: edit the files in the repository, review, build
and deploy. An account with shell access to the server can change the deployed
copies in `build/server/pica/`, as it can change the server code itself. That
happens outside of Pages and applies from the next message. Keep `build/`
writable only for the account that deploys Pages.

## Direct model selection and Pica (PAGE-124)

Agent Plan nodes select a concrete **connection + model ID** directly. No
administrator model profile or personal agent definition is required. The
connection's live usage scope admits everyone, named persons, group members or
department members; any matching target is sufficient. Administration alone
never grants usage. Equal model names on different connections remain separate.
Opening a page, choosing a model and saving only read known catalog metadata;
they never verify credentials or call a model. A saved key alone is insufficient.
Providers without a catalog expose their explicit manual model ID in the
connection editor. That choice is marked as manual in the model pickers.

**Settings → Agents** contains one fixed **Pica · Chat assistant** card, then the
existing API and CLI connection management. Activation, exact model and supported
reasoning effort are saved together. Standard means the provider/CLI default;
only catalog-listed explicit levels are accepted. Unsupported effort after a
model change resets visibly to Standard before saving. An unavailable saved
selection remains visible, with no implicit model fallback or change of activation.
Model and reasoning edits on the same connection retain migrated runtime
options; selecting another connection uses that runner's standard options.

The model lists of Pica and the plan editor come from the picker of each
target's own CLI: this host for a local connection, the runner host for a remote
node. Two targets may therefore offer different Claude versions and levels. A
Claude Code model is named with its version (`Sonnet 5.5`) and shows the concrete
model ID (`claude-sonnet-5-5`) beside its access; that ID is what is stored and
passed on, never a family alias or another model. Reasoning levels that the
target reports for some model but not for the chosen one stay in the list,
disabled, with the model named as the reason; a level or mode that no catalog
reports (such as `ultra`, or Fast Mode) is neither offered nor accepted. A family
alias saved earlier, such as `sonnet`, is shown with the version the CLI's own
picker maps it to and becomes the concrete ID when the selection is saved;
`default` and an alias the catalog cannot tie to one model stay as they are and
are reported. Pages and the runner start Claude Code with the model fallback and
the remap of retired model names switched off, so a model that is gone fails the
start with a clear message instead of being replaced.

Turning Pica off hides its launcher and unmounts its panel. Other open views
refresh on focus or within 30 seconds. Server-side checks apply immediately to
new sessions, turns and provider work. Turning Pica off or changing its identity
cancels current Pica requests/jobs through the existing controlled cancellation
path; existing messages and attachments remain. Agent Plan runs use a separate
engine and are unaffected. Every Pica turn still checks the acting person's
connection scope. ACP sessions continue only with matching connection, model,
reasoning and runner fingerprint; a changed selection creates a new native
session without replacing conversation history.

**Agents Liste** and the profile management UI are retired. Old `/agents/agents`
links redirect to the plan editor with an explanation. Retained definitions are
readable through compatibility APIs; creation, changes, cloning and deletion are
no longer offered. Direct requests return the stable `operation_retired` reason
(or the existing capability denial for a credential that does not offer the
retired operation). Old settings profile forms return HTTP 410 with
`profile_management_retired`. No navigation or read deletes old data. ACP
resources remain under **Settings → System**, while Tools remains protected.

The additive migration `066_pica_settings.sql` creates the fixed settings row.
A single usable legacy system Chat assignment is adopted once; a missing,
ambiguous or invalid assignment remains disabled and requires an explicit choice.
Existing profiles and connections stay stored. Startup adds direct connection
references to unambiguous saved node copies, including group/loop members,
without replacing pinned instructions, bindings, run options, graphs or historical
run snapshots. Unresolvable legacy references retain their original values and
block execution until explicitly repaired. An unsafe or currently busy graph
write is deferred with a diagnostic; its original graph stays available.
No migration starts a plan or chat.
