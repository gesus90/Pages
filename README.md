<p align="center">
  <img src="./assets/banner.png" alt="Pages logo between a stylized task board and a wiki page" width="100%" />
</p>

<p align="center">
  <strong>Self-hosted project management and wiki.</strong>
</p>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-24292F?style=flat-square" alt="License: MIT" /></a>
  <img src="https://img.shields.io/badge/Node.js-%E2%89%A522.22-24292F?style=flat-square&logo=nodedotjs&logoColor=5FA04E" alt="Node.js 22.22 or newer" />
  <img src="https://img.shields.io/badge/React%2019-24292F?style=flat-square&logo=react&logoColor=61DAFB" alt="React 19" />
  <img src="https://img.shields.io/badge/TypeScript-24292F?style=flat-square&logo=typescript&logoColor=3178C6" alt="TypeScript" />
  <img src="https://img.shields.io/badge/DuckDB-24292F?style=flat-square&logo=duckdb&logoColor=FFF000" alt="DuckDB" />
</p>

## About

Agent Plan supports direct Bash, Python and Node.js script steps through configured
interpreter profiles. See the [script runtime contract](backend/service/agents/ScriptRuntime.md)
for authorization, stdin/stdout, limits, parallel joins, pause/stop and recovery.

Pages is a self-hosted web application for planning projects, tracking tickets
and keeping a wiki. Several users share one instance; roles and departments
decide what each account can see and change.

- Projects with departments, templates and an archive
- Tickets on a Kanban board and in a list, with hierarchy, milestones and attachments
- Wiki pages per project or for the whole instance, with search, attachments
  and a trash
- Optional AI model connections (API keys, or Codex CLI, Claude Code and
  OpenCode accounts), managed by administrators, for Pica chat and agents
- German and English interface; light, dark and system theme

Pages is in early development (version 0.1.0).

## Tech stack

| Area      | Technology                                               |
| --------- | -------------------------------------------------------- |
| UI        | React 19, TypeScript, Tailwind CSS 4, Radix UI, Lucide   |
| Framework | React Router 8 in framework mode, server-side rendering  |
| Runtime   | Node.js                                                  |
| Database  | DuckDB, one file per instance                            |
| Text      | i18next (German, English), Tiptap editor                 |
| Tooling   | Vite 7, pnpm, ESLint, Prettier, Vitest                   |

## Architecture

React Router renders every page on the server and hydrates it in the browser.
Server code follows one dependency direction:

```text
Route / Loader / Action    app/routes/
        ↓
Service                    backend/service/
        ↓
Repository                 backend/database/repositories/
        ↓
DuckDB
```

Routes handle the request, services hold the business logic, repositories hold
the SQL. React components live in `app/components/`, shared types and contracts
in `definition/`.

## Navigation and draft saving

Navigation shows the destination and its loading state immediately. Already
available wiki text and ticket description drafts appear while the target loads.
Wiki edits autosave after a short pause; ticket descriptions keep their explicit
Save action and show the new text while saving. Both drafts and background saves
survive navigation, including a target route that fails to load.

The shared status shows pending changes, backend-confirmed success and failures
with Retry. Writes to one object run in order; wiki revisions and the ticket's
original description prevent silently overwriting another edit. Document sequence
numbers also fence late HTTP attempts after an aborted save, even when the new
request restores the original text. Conflicts keep
both versions until the person chooses. Retrying a confirmed text save creates
no extra edit. Every write still checks authorization and validation on the server.

Drafts belong to the current browser document and account. Reloading or closing
with pending changes triggers the browser's data-loss warning; continuing past
that warning discards unconfirmed input. Ticket drafts that have not been saved
remain available when navigating back, with an unsaved indicator.

## Ticket and milestone archive rights

UI and MCP archiving share the server decision in `TaskAccessGuard`: the current
`milestones` capability plus responsibility for the visible target's project.
Project responsibility is the project's Manager assignment or the scoped
`manage_projects` capability (managed project departments or `allProjects`).
Ordinary ticket writing, assignment and membership rights do not grant archiving;
an additional `write` capability is not required. Current project access still
applies, and tickets must be public or in the account's own departments. Hidden
descendants prevent archiving an entire subtree. Milestones follow project
visibility and have no separate department assignment.

Administrators qualify in active administrator mode in the UI. MCP keeps the
existing personal-administrator interpretation, regardless of the browser's
selected role mode; it does not change that mode. Both channels use the same
archive service and policy with their existing account interpretation.

Archiving is soft: ticket rows and workflow status remain, and active descendants
are archived recursively by default. Only newly archived tickets receive archive
history entries. A milestone leaves active views; its incident dependencies are
removed, while its tickets and their assignments remain. There is no automatic
purge. Permanent deletion is a separate administrator action in Pages.

The compatible MCP names `delete_ticket` and `delete_milestone` mean archiving.
They require exact `LÖSCHEN`/`DELETE` confirmation in the current account language.
Every call, including an `operationId` replay, rechecks the account, target
visibility and archive rights. `tools/list` advertises operations and proves no
right on a target. Visible unauthorized targets return `FORBIDDEN`; hidden or
missing targets return `NOT_FOUND`. Rejected calls create no archive history,
project activity or operation key. Identical authorized repeats return the stored
result without writing again; changed input returns `CONFLICT`. See the
[MCP archive contract](./mcp/README.md#milestones-initiatives-tags-and-links).

## GitHub issues: Done and archive

The GitHub synchronization of a project mirrors a linked ticket with the issue
of the repository. Title, description and the link stay as they are; the
completion state is carried over as follows.

GitHub's "complete" means that the **issue is closed** (`state: closed`, as
opposed to `open`). Pages does not read or write the custom **Status** field of a
GitHub Projects (V2) board, so a board column has no effect on a ticket, and a
ticket never moves a card.

| Pages ticket                               | GitHub issue at the next sync |
| ------------------------------------------ | ----------------------------- |
| active, status **Done**                    | closed                        |
| active, any other status                   | open                          |
| archived, whatever its workflow status     | closed                        |
| restored, status other than **Done**       | reopened                      |
| restored, status **Done**                  | stays closed                  |

- **Archiving** stays its own state in Pages. It does not change the workflow
  status and neither deletes nor unlinks the issue; the issue is only closed.
  Tickets archived together with a parent are covered the same way, each through
  its own link. An archived ticket that is not linked never gets an issue.
- **Closing an issue** moves the _active_ ticket to the project's **Done** status;
  it does not archive the ticket. An archived ticket keeps its status.
- **Reopening an issue** takes a ticket out of **Done**, as before. It never
  restores an archived ticket, and the issue of an archived ticket is closed
  again by the next sync.
- A repeated sync without a change on either side changes nothing and creates no
  second issue.

The changes travel with the existing manual and scheduled sync. Direction,
permissions and conflicts apply unchanged: a ticket that changed on both sides is
flagged for a decision instead of being overwritten, a direction that only pulls
never writes to GitHub, and the actor needs write permission on the project.
With the synchronization switched off (`sync_enabled = false`) nothing is read
from or written to GitHub. There is no "last write wins" rule.

## Discord notifications

A project can send notifications about its tickets and milestones to one
Discord text channel. A bot posts them; it is added to the Discord server through
Discord's official installation flow. Nothing else of Discord is used: no
commands, no replies, no direct messages, no reading of messages and no gateway
connection.

### Set up the Discord application (once per instance)

An administrator registers one Discord application for the whole Pages
instance. Projects never ask for credentials.

1. In the [Discord Developer Portal](https://discord.com/developers/applications)
   create an application (for example "Pages").
2. **Bot:** create the bot and copy its token. No privileged gateway intent is
   needed, leave them off. Switch on **Public Bot** if people other than the
   application owner add the bot to their servers.
3. **OAuth2:** copy the client secret and add the redirect
   `<public address of Pages>/discord/callback`, for example
   `https://pages.example.com/discord/callback`. It has to match exactly.
4. Set these environment variables on the Pages server and restart it (see
   [.env.example](./.env.example)):

| Variable                       | Value                                                              |
| ------------------------------ | ------------------------------------------------------------------ |
| `PAGES_DISCORD_APPLICATION_ID` | Application ID (the OAuth2 client ID)                              |
| `PAGES_DISCORD_CLIENT_SECRET`  | OAuth2 client secret                                               |
| `PAGES_DISCORD_BOT_TOKEN`      | Bot token                                                          |
| `PAGES_PUBLIC_URL`             | Optional. Public address of Pages, for example behind a proxy      |

Without all three secrets, the Discord panel of a project explains which
variables are missing and offers no way to connect. The values stay in the
server process: they are never sent to a browser, never stored in the database
and never logged. To rotate a secret, reset it in the portal and restart Pages.

`PAGES_PUBLIC_URL` decides the redirect address and the links in messages. Set
it whenever the address the browser or phone uses differs from the one Pages
sees, for example behind a reverse proxy; otherwise the address of the request
that starts the connection is used. A phone can only finish the connection if it
reaches that address.

### Bot permissions

The installation link asks for the scope `bot` and the permissions
`View Channel` (1024) and `Send Messages` (2048), together `3072`, and for
nothing else. A channel can only be chosen when the bot can see it and send
into it. Pages computes this on the server from the roles of the bot and the
overwrites of the channel. Only text and announcement channels are listed.
Channels the bot cannot use stay in the list, disabled, with the missing
permission next to them.

### Connect a project

Under **Projects → project → Interfaces** the Discord card opens the settings
panel. Everyone who can read the project sees it read-only; connecting, the
channel, the events, the test message and disconnecting need the right to write
in the project, the same as for the GitHub interface.

1. **Connect Discord** starts a connection attempt. It lives 15 minutes, can be
   used once and is bound to your Pages user and the project.
2. On a computer the panel shows a **QR code** and a button. Both open the same
   official Discord authorization page; the QR code is only the entrance and
   proves nothing. On a phone use the button.
3. Choose the server in Discord. Discord sends the browser to
   `/discord/callback`. That can be the phone that scanned the code: no Pages
   session is needed there. Pages checks the random `state` (only its hash is
   stored, and it works once), exchanges the code, and asks Discord with the
   bot token whether the bot really is on the server the answer names.
4. The panel on the computer notices the result and lists the channels of that
   server. **Server and channel are confirmed there**; only then is the
   connection saved.
5. Four switches select the events **Ticket created**, **Ticket changed**,
   **Milestone created** and **Milestone changed**, each on its own. A new
   connection starts with all four on.
6. **Send test message** posts into the channel at once and shows why it failed
   if it does.
7. **Disconnect** removes the server, the channel, the event selection and the
   messages not sent yet of this project. The bot stays on the Discord server
   (remove it there if you do not need it any more), and other projects stay
   connected.

### What is sent

A message names the event, the ticket key or milestone name, the title, the
status, the project and the link to Pages. It carries no description and no
person. Titles cannot ping anyone: every message disables all mentions
(`allowed_mentions` with an empty `parse`), and `@`, `<…>`, markdown and links
in titles are neutralized as well. Tickets that belong to a department are not
announced, because the channel is not limited to that department.

Changes made in the interface and by agents (MCP and chat) are announced after
the Pages change committed. A refused, conflicting or rolled back change
announces nothing.

### Delivery and failures

A committed change writes a message to a stored outbox; a worker delivers it
asynchronously, so Discord never blocks or undoes a Pages change.

- Changes of one ticket or milestone that arrive while its message still waits
  are merged into that message, which keeps its event and shows the newest
  facts. A template that adds labels and checklist items to a new ticket
  therefore sends one message, not one per step.
- A failed delivery is tried again after 30 seconds, 2 minutes, 10 minutes,
  30 minutes and 2 hours, and given up after the sixth failed attempt or after
  a day. The panel shows the counters and, in words, the problem that stands.
- A Discord rate limit moves the message to the time `Retry-After` names. It
  does not count as a failed attempt and holds back the messages behind it.
- A problem a retry cannot fix (rejected credentials, the bot removed from the
  server, a deleted channel) ends the delivery at once.
- Every message carries a nonce derived from its identifier, and Discord does
  not create a second message for a repeated nonce. A retry after a lost answer
  therefore does not post twice.
- Stored messages survive a restart. Like the GitHub synchronization, the
  delivery starts with the first request after Pages started.

### Manual acceptance with a real server

Automated tests replace Discord. To check the real thing, set the three
variables, add the redirect in the portal and then:

1. Open **Projects → project → Interfaces → Discord** and choose **Connect
   Discord**.
2. Scan the QR code with a phone, choose a test server and approve. The phone
   shows "Server authorized".
3. On the computer the panel shows the server and its channels. Choose a channel
   and confirm.
4. Send the test message and check it arrives in the channel.
5. Create and change a ticket and a milestone, also through an agent, and check
   one message per switched-on event, with no ping.
6. Switch an event off, disconnect, and check nothing is posted afterwards while
   the bot is still on the server.

## Pica API runtime (PAGE-83, partial)

The production Pica chat now runs API models through the shared Mastra runtime.
Its native catalog has fixed tools, each on an existing Pages operation with
the current account rights:

| Kind | Tools |
| ---- | ----- |
| Reads | `projects_list`, `projects_read`, `departments_list`, `tickets_search` (in one project; `assignedToMe` for the person's own tickets), `tickets_read`, `assignment_targets_search`, `tags_list`, `milestones_read`, `wiki_search`, `wiki_tree_read`, `wiki_page_read`, `wiki_comments_read` |
| Tickets | `tickets_create`, `tickets_set_title`, `tickets_set_status`, `tickets_set_description`, `tickets_set_assignee`, `tickets_set_tags`, `tickets_set_parent`, `tickets_set_milestone`, `tickets_delete` |
| Projects | `projects_create`, `projects_set_name`, `projects_set_description`, `projects_set_status`, `projects_set_dates` |
| Milestones | `milestones_create`, `milestones_set_name`, `milestones_set_description`, `milestones_set_status`, `milestones_set_start_at`, `milestones_set_due_at`, `milestones_delete` |
| Wiki | `wiki_page_create`, `wiki_page_set_title`, `wiki_page_set_content`, `wiki_page_move`, `wiki_page_delete`, `wiki_comment_add`, `wiki_comment_edit`, `wiki_comment_resolve`, `wiki_comment_delete` |

There is no generic operation tool, no administration (accounts, agents,
connections, instance settings, the tag catalog) and no text-action fallback,
also not for administrators. `projects.list`, the read behind `projects_list`,
is also an operation of the agent API. Wiki comments are the only comments
Pages has; tickets have none.

Pica acts on user level when the person asks, without a confirmation line or
word (PAGE-68), and names the result. Every call runs through the existing
services with the current rights of the person; a missing right returns
`FORBIDDEN`, which Pica reports. Changes carry the expected old value or
revision wherever the operation checks one, so a concurrent change ends in
`CONFLICT` instead of being overwritten. Tickets, milestones and wiki pages are
deleted into the trash; Pages adds the confirmation word the deleting
operations require from the person's language itself, and a model can neither
pass nor omit it. A write that failed is refused with `RETRY_REFUSED` when it
is sent again unchanged in the same turn. A text of a write holds at most
20,000 characters, as much as a tool result can show.

The production composition selects `native-api` explicitly. `legacy-actions`
preserves the previous broader catalog for compatibility and its regressions;
it never runs alongside the native path or as an automatic fallback. The agent
and plan chat sections below describe that retained catalog, not the native
tools currently exposed in production. Other operations, web search and Mastra
Memory remain outside this partial implementation. Pages still owns
the transcript, attachments, summaries and `/compact`.

A Codex CLI, Claude Code or OpenCode agent assigned to the chat runs over ACP
instead (next sections). `/compact` stays an API-model function.

## Pica execution budgets (PAGE-103)

API, ACP and legacy actions permit up to **256 actual Pages tool executions
per turn**. Validated calls reserve their place before dispatch, including
failed service calls; rejected schemas, unknown tools and refused repeated
failed writes do not execute a service. Call 257 is refused as `STEP_LIMIT`.
ACP stops the job with the translated limit status and retains its journal;
the API path reports the limit even if the model subsequently returns text.

Injected steering shares the current budget. A separate follow-up gets a fresh
budget at the native prompt boundary, including adapter-started turns whose
first calls arrive before Pages dequeues them. A new message in a resumed
session also starts fresh; the one-time failed-resume fallback keeps the same
turn budget. Rights, abort signals, client-message idempotency and failed-write
retry protection remain in force.

The Mastra ceiling is **258 model steps**: 256 single-call steps, one possible
refusal and one final text step. Multiple calls in one step still share the
256-call budget. Legacy mode separately bounds model iterations to 258, so
malformed actions cannot create an unbounded loop. Provider retries stay off.

The chat request registry allows **90 minutes per request/job**, with the
existing capacity of 16 and one request per person. This budgets 20 seconds
per model/tool cycle plus 280 seconds for startup and completion. Follow-ups
share the job deadline; steering does not extend it. Explicit shorter Claude
Code/OpenCode agent timeouts still apply; Codex keeps the chat deadline as
before. Provider context limits, bounded history, attachment/result size
limits and resource admission still apply, so 256 calls is a ceiling rather
than a guarantee for arbitrary workloads.

## Pica over Codex ACP (PAGE-68)

When the chat agent under *Settings › Agents* uses a Codex CLI connection, Pica
answers through `codex-acp` with the same native tools. There is no model choice
in the chat and no fallback to an API model; the assignment is resolved anew
for every new answer, so a change applies from the next message on.

- **Server-side jobs.** Sending stores the message and starts a job on the
  server. Closing the browser, switching tabs or a lost connection does not end
  it; only *Stop* does. The panel reads the job's journal after its last cursor,
  so returning shows the current state or the finished answer without running
  anything again. *Stop* keeps what Pica had written in the running turn as its
  answer, marked as stopped (migration 054); a new agent session receives it
  marked as incomplete.
- **Sent once.** Every message carries a client message ID, which stays the
  same when the browser sends the message again unchanged after a failure. A
  conversation stores each ID once (migration 052): a repeat returns the job
  or steer of the first sending, and on the API path it is refused as already
  sent. A second Enter or click before the panel updated sends nothing.
- **Steering.** While Pica answers, sending stays possible. The message goes
  into the running turn through `_session/steering` (status *accepted*); a
  message that arrives between turns, or that the adapter no longer takes, is
  answered in a turn of its own (*follow-up*). Statuses: pending, delivered,
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
[backend/agents/acp/CodexAcpCapabilities.md](./backend/agents/acp/CodexAcpCapabilities.md).

## Pica over Claude Code ACP (PAGE-90)

When the chat agent under *Settings › Agents* uses a Claude Code connection,
Pica answers through `claude-agent-acp` on the same server-side jobs, journal,
steering, attachments and tool bridge as with Codex: jobs run on without the
browser, a message is stored once, steers and selection snapshots keep their
statuses, and the native tools act on user level as described in the PAGE-83
section. This section names what differs.

- **Assignment only.** Connection, model, effort and the permission mode come
  from the assigned chat agent and nothing else: no model default, no fallback
  to Codex, an API model or another process. The mode must be *Read only*,
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
  current generation and joins the same turn (*accepted*). A steer that finds
  the turn already ended comes back with `promptRequired`, because Pages asks
  for that, and is answered once in a turn of its own (*follow-up*).
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
[backend/agents/acp/ClaudeAcpCapabilities.md](./backend/agents/acp/ClaudeAcpCapabilities.md).

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

- **Scope and isolation.** Pica requires *Read only* workspace access. It uses
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
  Losing or closing the browser leaves the server job running. *Stop* ends
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
[backend/agents/acp/OpenCodeAcpCapabilities.md](./backend/agents/acp/OpenCodeAcpCapabilities.md).
OpenCode plan nodes also use the native ACP entry point; see
[OpenCode plan setup](#opencode-plan-nodes-with-a-console--zen-key-page-66).

## Pica live activity (PAGE-103)

While an API request or ACP job runs, the message list shows one compact row:
the unchanged Pica mascot, three orange dots, a neutral phrase that changes
every 20 seconds, and elapsed wall time. The timer updates once per second
from `ChatJob.createdAt`, or the local API request start until a server job is
known. Closing and reopening the panel keeps that start; hidden panels need
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

`/compact` summarizes older conversation context while retaining the latest four
messages in context and every original message in the displayed transcript.
The summary is persisted separately and used by subsequent Pica turns. Short
context, or a summary that would not reduce it, produces a no-op notice.
Compaction and chat turns share the request registry, so they cannot run in
parallel for the same person. Errors or concurrent changes never replace the
previous summary or the stored transcript.

The small context indicator estimates tokens in the bounded conversation history
and saved summary using roughly four characters per token. Its tooltip is
available on pointer hover, keyboard focus and touch, and closes with Escape.
It marks estimates and unavailable values, and shows a model limit and estimated
conversation share when the assigned model's catalog provides that limit. This
is conversation context only: system instructions, new attachments and current
turn action results are excluded.

MCP session deletion uses a separate adapter and still requires exactly
**LÖSCHEN**, including with an English interface. See the
[MCP session tools](./mcp/README.md#pica-sessions).

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
- **Refresh and reset.** *Refresh* updates the waited time; *Reset* ends the
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
URL in every server-rendered page.

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
operation, and no Pica action. *Settings › System › Chat assistant Pica* keeps
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

## Ticket parameters and assets (PAGE-60)

Declare a single parameter of type `ticket`, for example `ticket` or `referenz`.
Its saved value stays `{ "type": "ticket", "ticketId": "…" }`; users do not
select an additional asset parameter. At execution, Pages resolves it to:

```ts
{
  id: "ticket-id",
  key: "PAGE-60",
  title: "Ticket title",
  description: "The complete, untrimmed ticket description",
  assets: [
    { source: "ticket", id: "attachment-id", link: "/aufgaben/attachments/attachment-id" }
  ],
  markdown: "# PAGE-60: Ticket title\n\nDescription and stored acceptance criteria",
  version: "opaque revision"
}
```

| Placeholder | Instruction text | Separate file delivery |
| --- | --- | --- |
| `{{ticket.description}}` | Exact complete description | None |
| `{{ticket.assets}}` | Asset references with parameter name, ticket ID and key | All ticket assets |
| `{{ticket}}` | Compatible complete ticket text, including title and stored criteria | All ticket assets |

The same syntax works with any declared ticket parameter name, such as
`{{referenz.description}}` and `{{referenz.assets}}`. Substitution happens only
once: placeholders inside a description or file are literal data. Repeated
placeholders do not duplicate the files within a parameter. Each delivered file
carries its parameter name, ticket ID/key, original reference and filename;
two parameters selecting the same ticket retain two distinct associations.
An empty asset list is valid and leaves the full description available.

Assets include every ticket attachment and used Markdown image/file references
to `/aufgaben/attachments/<id>`, `/wiki/attachments/<id>` and
`/agent-assets/<id>`, including reference-style Markdown links. As with Pages
wiki references, a server address or deployment prefix can precede these paths;
only the Pages identifier is resolved, never an external network resource.
Duplicate references are delivered once per parameter. Code examples do not
request files. External or relative PNG/TXT links and images must first be
uploaded to Pages; they fail explicitly instead of becoming filename-only input.
PNG images and complete UTF-8 text files are supported (including TXT uploaded
as `application/octet-stream`); other binary formats fail explicitly. The total
unencoded file contents of one transmission are limited to 10 MiB. Exceeding
that limit fails the run without truncating or omitting a file.

Direct runs and Agent Plans share this resolution and delivery path.
OpenAI, OpenRouter, Anthropic and Google API agents receive native image blocks
and separate complete text blocks. Codex, Claude and OpenCode ACP sessions receive PNG
image blocks after the adapter advertises image support; text is an embedded
resource when supported, otherwise a complete separate text block. Standalone
text-only CLI requests do not support file delivery and report
`parameter_asset_transfer_unsupported` when files are selected. A model/provider that rejects image input fails the run;
Pages never silently falls back to metadata or another model.

For a following agent in a plan, bind the same ticket source to its ticket
parameter. Pages resolves that ticket again under the executing user's current
rights and retains the description, asset references and parameter association.
An agent result is text: a result-to-ticket connection is refused with the
explicit `ticketHandoff` graph finding. A text result derived from ticket assets
also requires those same tickets and asset lists to be bound to the receiving
agent; otherwise the runtime reports `parameter_asset_transfer_unsupported`.
Runtime-native subagent delegation is
outside Pages' structured handoff contract; it is not a way to obtain additional
Pages permissions or a guaranteed asset transfer.

Every file read uses its original ticket, wiki or staged-asset access policy.
Ticket selection and sharing never grant file rights. Plan snapshots contain
references, not file bytes or reusable download credentials. Immediately before
the API/ACP prompt, Pages rechecks the executor, ticket and each file. Changed
asset references between preparation and transmission require a new run. Text,
status and checkbox revisions alone do not invalidate the file handoff; ticket
and file authorization are still checked against current state. Missing,
deleted, inaccessible, unreadable, invalid-UTF-8 and oversized
files produce an explicit error; the prompt is not sent partially. Historical
run reads also reauthorize the original asset references, even after their
links have been removed from the ticket description.

## Remote working directories (PAGE-138)

The page **Agents → Arbeitsverzeichnis** lists remote connections above the
workspaces. A remote connection is SSH access to a Linux machine, for example
an Ubuntu container on a NAS; Pages itself stays where it runs.

- **Configuration.** Only administrators add, edit, test and remove
  connections: name, host name or address, SSH port, SSH user, sign-in method
  (password, private key, private key with passphrase) and exactly one
  department. Members of that department use the connection; there is no
  global or per-person sharing. Every action rereads account, memberships and
  project rights, so a revoked membership blocks the next use.
- **Secrets.** Passwords, keys and passphrases are encrypted with the existing
  instance cipher (the key next to the database, or `PAGES_GITHUB_TOKEN_KEY`),
  bound to the connection and the kind of secret. No response and no log
  contains them; the dialog only says whether one is stored. They are separate
  from Codex, Claude and OpenCode logins.
- **Host key.** "Verbindung testen" checks reachability, host key and sign-in
  separately. The machine's key is shown with its SHA-256 fingerprint and must
  be confirmed before a password or key is sent; every later connection
  accepts only that key. A new host or port drops the confirmed key. While no
  key is confirmed, the status asks to confirm it in the dialog, because no
  reconnect attempt can sign in without it.
- **Workspace profiles.** A connection can carry several profiles. Each has a
  stable identifier, one project (whose GitHub link is shown and used) and the
  canonical absolute path that a read-only check over SSH found readable,
  writable and traversable. A `host:path` text is no connection.
- **Allowed directories.** Each connection lists the absolute directories its
  profiles must lie in ("Erlaubte Verzeichnisse"); without an entry only the
  SSH user's home `/home/<user>` is allowed. The check compares the canonical
  path on the machine with the directories as written and as resolved there,
  so neither `..` nor a symbolic link leads outside; a path outside is refused
  as such. A changed list leaves the stored state of registered profiles as
  it is; their row shows "Prüfung veraltet" until "Prüfen" applies the new
  list. Profiles are not rechecked automatically.
- **Logical connection.** Checks open one OpenSSH connection per remote
  connection, watched by keepalive probes and closed after ten idle minutes.
  A lost transport starts at most ten reconnect attempts at the growing
  intervals of plan retries (1 s to 5 min); the page shows count, next attempt
  and cause. A first connect or a test of a closed connection starts the same
  series when the machine is not reachable or its host key is not confirmed
  yet; a confirmed key that differs and a refused sign-in are refused at once,
  because they need a person's input. Afterwards the connection is blocked
  until "Erneut verbinden" starts a new series. A command whose transport
  broke is reported as interrupted and is never repeated on its own.

Pages runs the OpenSSH client of the server (`ssh`, `ssh-keyscan`,
`ssh-keygen`, OpenSSH 8.4 or newer) with its own options: the account's
`~/.ssh` configuration, keys, agent and `known_hosts` are not used. Private
files of a running connection (pinned key, control socket, a key file that is
removed after the sign-in) live in an owner-only `pages-ssh-*` folder in the
temporary directory. The target needs a POSIX login shell.

Remote profiles are not yet offered to Agent Plans and the MCP workspace
operations; running plan nodes and CLI/ACP adapters on the remote machine is a
follow-up.

## Agent Plans

Under **Agents → Agent Plan** (`/agents/plans`) the plan editor is one
[React Flow](https://reactflow.dev/) canvas over the whole content area beside
the global navigation, from the global header to the bottom of the window
(PAGE-102). It shows only the nodes, their connections and one compact zoom bar
at the top left: **−**, the current zoom in percent, **+** and **Fit all nodes**.
An expandable plan/run panel floats inside the editor, alongside the zoom bar
on wide canvases and below it on narrow ones (PAGE-106). It is independent of
the graph and its zoom. There are no permanent side/bottom panels or MiniMap;
the canvas has no frame and no scroll area of its own. The Pages background and its
dotted raster continue under the graph in the light/dark semantic palette; the
dots fade out towards the edges. Drag the empty area to pan; the wheel or pinch
gesture zooms. Fitting keeps the existing positions and leaves room for the zoom
bar. The initial fit runs when the graph opens; run-status updates keep the
viewport and selection, and the canvas follows window and sidebar resizing.

Without a `planId` in the address the editor opens the plan named **Task2**
among the plans you may read, your own one first. This is a provisional
default, not a stored setting, and nothing is created for it. A `planId` in the
address takes precedence. If the requested plan or Task2 is missing or not
readable, the canvas stays empty and says so; no other plan is opened instead.
The panel starts collapsed on every page opening; its state is not stored.
Its header shows project, workspace, server status and Play/Pause/Resume/Stop.
Expand it to choose a plan, rename it, select a project and one of its
workspaces, and explicitly save. Full context names stay available in the
expanded panel. Workspace administration uses the existing management page.
The existing Pica/MCP plan operations and their save paths remain: the owner and
the members and leaders of a plan's team (see Team plans and templates) save and run it.
Readers a plan is only shared with see control metadata without private run
outputs and cannot edit or run the plan.
Polling failures leave the editor and local draft mounted. Run actions remain
disabled until the server can be reached again; reconnect only reads state and
never resends a mutation. The panel's controls stay visible while its expanded
content scrolls.
The zoom bar sits directly below the panel in the same floating stack and
follows its expanded or collapsed height. The stack stays inside the editor
when the navigation or window changes size; pan and zoom move only the graph.

Move nodes, frames, starts and ends by their header or checkpoint symbol; the
grabbed point stays under the pointer at every zoom level and positions snap
to the raster. Grid coordinates range from 0 to 6000; dropping or keyboard
movement commits a snapped, bounded position. Names, instructions, parameters
and supported run options are edited directly on each agent node.

An ACP group is a yellow session container on the grid (PAGE-113), with no
flow, input, result or session ports. Agent connections determine execution;
the frame is never an additional executable step. The first member sets the
technical runner class: Codex, Claude Code or OpenCode over ACP. Other runner
classes and API agents are refused without reconfiguration. Empty groups remain
neutral drafts and may be saved, but cannot run.

Members keep their own ports and may connect to agents inside or outside any
frame. Moving an agent across a frame preserves its connections and bindings.
Only explicit flow edges add dependencies; the group's positions and membership
order add none. Simultaneously ready turns of the same group queue in the
scheduler's stored frontier order. Independent groups keep their own concurrency.
The common workspace of one group is protected by this serial turn queue.

The header shows the runner, a readable status and successful agent steps over
the known group membership of the selected run. Failures and blocked inputs
precede activity; unfinished groups reflect pause and stop controls. Failed or
cancelled steps never count as successful. Missing run membership or access
errors show an unknown total; an empty total paints no completed ring. The finite
DAG scheduler does not implement dynamic iterations.

The chevron collapses the frame into a compact card with a small ring and its
count beside it. This is local React state, initially open and reset by a new
visit/reload; it neither saves the plan nor controls execution. Hidden members
remain in the graph. External lines keep their original agent names and link
identities, ending at noninteractive visual anchors on the compact card. These
anchors are not group ports and cannot create new connections. Dense external
links have spaced labels naming the actual agents and short leader lines to
their noninteractive anchors; the frame stays compact. Expanding restores
the same member positions, internal/external edges and selection without moving
the viewport. Names remain available through focus and tooltips.

Older JSON plans are upgraded idempotently when read and before saving or run
preparation. A legacy frame edge is resolved only when exactly one entering or
leaving member exists. Otherwise the original edge remains and blocks execution;
the group editor offers an explicit agent endpoint choice. Legacy input aliases
become their actual member bindings/defaults; original boundary definitions stay
readable as provenance. No historical run snapshot is rewritten. The existing
JSON schema needs no SQL migration. Removing only a frame requires unresolved
legacy frame edges to be repaired first and keeps all member connections.

Every member must resolve to the same adapter, connection, model, reasoning,
workspace/directory, tools, permissions and sandbox; inherited defaults are
resolved first. Conflicts identify the agent and setting. The first member that
actually runs opens one ACP session per group and run. Subsequent members send
turn-scoped instructions through `AcpSession.next` and `session/prompt` to that
same session in the same process. The session is retained until every actual
member has succeeded, or run closeout/Stop ends it. This includes a later
frontier whose member depends on work outside the group. A failed
opening, missing continuation method, changed effective runtime or lost process
never permits a silent replacement session. Each turn reauthorizes access.

The footer's read-only ACP identifier belongs to the selected run and group;
without a real recorded identifier it says "not created yet". ACP identifiers
are not native thread IDs, process IDs or durable restart handles. After an idle
timeout or host restart, continuation of a lost retained session blocks rather
than opening an empty context. A deliberately new run gets a new session. Every
group turn still requires accepted business progress. Pause drains active work
and preserves retained sessions within existing idle limits; Stop revokes access
and closes active or idle retained sessions. Credentialed provider continuation
must be verified separately for each installed runner version; a local dummy ACP
peer proves only Pages' protocol, queue and error handling.

The practical example can be reproduced with
`pnpm exec tsx scripts/agent-group-proof.ts --data <isolated credential data>
--connection <connection UUID> --workspace <empty workspace> --model <model ID>
--effort <effort> --output <artifact folder>`.
The script uses transient definitions and in-memory plan storage with the real
scheduler, parameter binding, acceptance and Codex adapter. It connects no Pages
MCP server, changes no tickets, and records neither credentials nor account files.

A parameter node contains one name and one value: string, finite number or a
single valid JSON value, including an object or array. Invalid JSON is rejected
without creating fields from its properties. Numbers and JSON are passed as
text to the existing agent text parameters. Workspace and wiki references are
single values of their existing types and require matching input ports and
current resource access.

Drag from an **OUT** port to a compatible **IN** port, or click the OUT and
then the IN. While a connection is open, INs that accept it are marked green
and the others dashed; a release on the empty grid or Escape adds nothing:

- Solid **Flow OUT → Flow IN** edges control order. Agents have both ports;
  a **Start** has only OUT and an **End** only IN.
- Dashed **Data OUT → named Data IN** connections bind values directly to an
  agent parameter. Data alone never schedules a node.
- A ticket node is a value source, not a step: it has one **Ticket OUT** and no
  flow ports, and needs no Start. Connected to a ticket parameter, the agent
  receives the complete ticket as that parameter's value when the plan runs; a
  text parameter of an earlier plan still receives the ticket markdown. Plans
  that used tickets as flow checkpoints open with direct edges between the
  neighbours of those tickets. A ticket's status never changes implicitly.
- The ticket field of a ticket node opens a large choice below it (PAGE-109):
  search by key or title, a **Kanban phase** filter from the project's own
  workflow (menu and chips share one state; several phases combine with OR,
  the search with AND), and an order by title, creation or change time in
  either direction, newest change first by default. Opening it reads the
  project's visible, active tasks and subtasks again; archived, hidden and
  other projects' tickets never appear, also not in the count. Only choosing a
  row changes the node's ticket; arrows move, Enter chooses, Escape closes, and
  keys typed there never reach the canvas.
- A data IN accepts one source. Disconnect before rebinding. Wrong directions,
  unknown ports, incompatible types, duplicate connections and flow cycles
  are rejected. Predecessor-result connections are optional and require a flow
  path from the producing agent to the consuming agent. A flow edge alone
  passes no result: the result reaches an agent only through a declared text
  input bound to that result whose placeholder, such as `{{ergebnis}}`, its
  AGENT.md uses, once and as plain text. A bound result that AGENT.md does not
  use is marked unused and passes nothing. A placeholder without a source is
  refused before Play, named as ambiguous when several earlier agents could
  provide it; a result is never picked by itself.

Click a connection or its labelled chip, then use its **Disconnect** button to
remove it alone; both nodes stay.
Square flow handles and round data handles have larger pointer hit areas;
labelled port buttons offer the same validated connections from the keyboard.
Every connection is a soft Bezier curve, also its preview while it is drawn and
while nodes move: flow connections are solid, data connections dashed; both
have directional arrows, labels and visible selection. Invalid targets are
marked in the preview, and a refused IN chosen with the port buttons is named
below the zoom bar.
The node menu holds only **Delete** (PAGE-109): it removes the node together
with its own connections, never the referenced ticket, agent or run history.
Delete or Backspace removes the selected
node or connection while the grid or the selected node's header has focus, but
never while a field, menu or dialog has it.

An executable plan needs at least one usable agent, an explicit Start and a
reachable End. Every flow node must be reachable from a Start and lead to an
End; every required flow IN/OUT must be connected. Required agent inputs,
including a configured working directory, need connected, nonempty values.
Adding an agent node asks for a permitted connection/model pair and creates an
independent node configuration. Its working-directory input binds to the plan's
workspace. The pencil edits its name, instructions, typed parameters, run
options, model and reasoning level. Changing a model keeps instructions, inputs,
bindings and run options; unsupported options need an explicit correction.
Node templates remain optional independent copies, subject to current model
and resource rights at save and insertion. A withdrawn selection remains visible
and is refused at save and Play without a fallback. Inside an ACP group, models
of another runner stay listed but disabled; detach the node to select them.
Double-clicking an
agent node opens its PageAgentCLI console instead: the fixed ticket panel over
the dimmed plan with the node's session history, workspace and Git state,
requested and confirmed model and reasoning, context occupancy, token and cache
counts, and an instruction field. Opening it starts no process and closing it
stops neither the session nor the run. A group asks which of its agent steps to
open, and runs other than the newest active one are read only. Template edits, including
edits during an active run, never change existing nodes. Inserting the same
template again uses its current defaults. Existing saved plans receive their
independent copies once at server startup, under their normal revision checks.
Earlier plans keep their values and bindings. They need explicit Start/End
nodes and connected required parameters before Play.

**Ctrl+S** (**Cmd+S** on macOS) saves the plan wherever the focus is in the
editor; nothing is saved automatically. A save persists the metadata,
positions, port references, connections and values. Incomplete drafts can be
saved; invalid connections cannot. Revision checks reject conflicting writes.
Navigation and tab closing warn about unsaved changes, and run polling does not
replace an edited draft. A stored plan is confirmed by a toast; a running save,
a refused save and a read-only plan are named in a short notice below the zoom
bar. An agent whose current template cannot be loaded is not inserted, and the
group dialog says so. Read-only access also disables React Flow
dragging and connection creation; selection, pan/zoom, the agent console and
the existing read-only node dialog stay available.

Deleting a plan removes it for everyone it is shared with. Only its owner may,
and the server refuses anyone else; the editor offers no delete action. A plan
with a running or paused run cannot be deleted; finished runs stay in the run
records of the agents.

**Play** in the panel requires an explicitly saved draft and always starts a
new run. The server also retains its combined save-and-play action: unsaved
changes of the owner are saved first, under
the same plan, as the next revision, and that revision is started; the new
revision and the run are stored together, so a refused save starts nothing and
a refused start leaves the plan unchanged and the edits in the editor. A plan
that changed elsewhere in the meantime is a conflict and is never replaced by
the older version. Every Play is a new run with its own ID and fresh node
states: results, errors and blocked nodes of earlier runs carry over neither
into the run nor into the parameters of its nodes, and earlier runs keep their
snapshot. During Run, Pausing, Paused and Stop closeout, Play is disabled
with a stop-first explanation. Concurrent starts are rejected for the entire
plan, and working-copy reservations also protect other plans. Solid branches run independently. Non-ACP execution has at most two
concurrent nodes across the service; native ACP starts share the separate global
resource queue described below. A join waits for every incoming predecessor to succeed; a
failed predecessor blocks its continuation. Independent CLI branches may not
write to the same working copy. A server restart fails the runs it
interrupted and ends their processes; their working copies are released once
no process of their sessions is left.

The connection of an agent decides its runner: a Codex CLI or Claude Code
connection runs the node as an Agent Client Protocol (ACP) session through the
adapter of its CLI (`codex-acp` or `claude-agent-acp`, installed for the server
account next to the CLI, whose sign-in it reuses; see
[ACP adapters](#acp-adapters-for-the-cli-runners)); an OpenCode connection starts
its native `opencode acp` session in the node's workspace, without an adapter
package or a fallback to `opencode run`; an API connection stays a request without tools. Play stores a stable snapshot of each node's effective
configuration. Before a node starts, Pages uses that snapshot and binds every
parameter (a placeholder is never sent unresolved) and fixes the node's **todo list** (task list items of the node
instruction and of the bound tickets' descriptions) and **acceptance criteria**
(the acceptance criteria of the bound tickets). Both are stored with the run and
appended to the prompt together with an optional progress report. Later template
or saved-node edits leave the run unchanged; current template usage, model grants
and referenced resource permissions are still checked before execution. The sent
prompt and requested model, reasoning and run options remain available in the run
record. The exact model, reasoning effort and the agent's run options (workspace access, shell,
web, time limit) are passed with fixed, verified switches; a combination a
runner cannot enforce, including the retired workspace-write mode of a CLI
agent, blocks the start. The ACP adapter must offer and confirm the stored model,
effort and mode before the prompt is sent, and an adapter that maps the model
to a choice of its own (Claude) is checked against the model it reports with
its first usage update; otherwise the node fails with its own reason, and
Pages never switches to another model, to an API connection or back to an
earlier runner. Every runner works unattended:
nothing waits for a person, and an action the options do not allow is refused
instead of asked.

A Codex CLI, Claude Code or OpenCode agent runs in exactly one of two permission modes,
chosen on the Agent Plan node. **Read only** reads the workspace and Pages content
and may search the web, but creates, changes and deletes no files, runs no
commands and calls only reading Pages MCP operations; the server offers no
changing tool to it, and inside bubblewrap the workspace is mounted read-only.
For Claude Code the model gets no tool but Read, Glob, Grep, WebSearch and
WebFetch, so no file change and no command exists for it, and Pages answers
every remaining request itself. Codex reads files only through its shell,
which Read only switches off, so a Codex node in Read only works with Pages
content and the web; give it YOLO, or Claude Code, when it has to read the
workspace. **YOLO** gives the session every tool of the runner without
approval prompts: files in the workspace, shell, web and the full Pages MCP
catalog with the executor's rights. It starts only inside the bubblewrap
isolation, which keeps the instance folders and the other credentials out of
reach. An agent without run options reads only; an agent saved with the earlier
workspace write mode does not start until one of the two modes is chosen, and
it never becomes YOLO on its own. A Codex configuration file Pages does not
manage (`config.toml` in the connection's Codex folder, or `.codex/config.toml`
of the workspace's project) blocks the start, because it could add servers or
providers the agent does not name. A Claude session ignores the user and
workspace settings of Claude Code (`settingSources` is empty), reaches only its
own Pages MCP server (the account's connectors and user MCP servers stay out),
keeps no session history and switches off the automatic model fallback.

Codex CLI, Claude Code and OpenCode YOLO plan nodes can use the GitHub connection stored
in the selected workspace's Pages project. Pages rechecks the executor's
workspace access and project management rights (the existing GitHub write
permission) before decrypting that project's token. The agent connection,
model, plan bindings and prompt contain no GitHub secret. Read only nodes do
not receive GitHub credentials. Switching project GitHub synchronization off
keeps the connection available for these explicitly authorized repository
operations; synchronization settings are independent of repository access.

Install `gh` for the server account and configure the repository URL and token
in the project's GitHub settings. Prefer a fine-grained token restricted on
GitHub to that repository, with **Contents: read and write** for branch pushes
and **Pull requests: read and write** when the task needs pull requests; grant
other permissions only as needed. Organization approval, SSO, repository rules
and token expiry still apply. Pages does not borrow `GH_TOKEN`, `GITHUB_TOKEN`,
the server's `gh` login or desktop keyring. Missing tokens, decryption failures,
missing `gh` or missing project write rights appear in the node's effective
`github` diagnostic, while unrelated YOLO work can continue. Configure the
connection and explicitly start a new run after correcting such a problem.

Each ACP session gets a temporary `GH_CONFIG_DIR` outside its connection HOME,
with directory mode 0700 and file mode 0600. Only that directory is mounted
read-only into its namespace. A destination filter delegates HTTPS Git
credential responses to native `gh auth git-credential` only for the connected
repository, with or without `.git`. Matching SSH remote URLs are rewritten to
HTTPS for the process. Git settings travel through the environment and never
change the working copy's `.git/config`. Normal closeout and cancellation end
session processes before removing the directory; failed launches clean it up,
and startup recovery removes interrupted sessions' credential directories.
Each leftover directory is handled on its own. When Pages cannot confirm that
every process of its session ended, or cannot remove it, the directory stays,
the server log names it, the server starts normally and the next start tries
again. Until then the session keeps its ACP capacity and its run keeps the
working copy reserved. A file system without a creation time for the directory
cannot bound the process scan, so an unreadable process of the server account
then leaves the cleanup unconfirmed, unless the directory predates the last
boot.
Codex shells preserve the environment Pages has already allowlisted, including
`GIT_CONFIG_KEY_*`, without loading a user shell profile.

The destination filter and `GH_REPO` default are **not a restriction of the
token itself**. A YOLO process can read its own temporary token, invoke `gh`
with another repository or use the API directly, up to the token's native
GitHub permissions. Pages does not downscope a classic or otherwise broad
token. Use a token restricted by GitHub when repository isolation is required.
The handoff exposes only the selected project's token, never credentials of
another Pages project or connection.

Every Codex CLI, Claude Code or OpenCode plan node gets the local Pages MCP
process with its own credential: in Read only with every reading operation, in YOLO with every
operation of the executor, both under the executor's current rights. The
credential travels in the process environment or the session request, never in
arguments, prompts or the interface, and is revoked when the node closes.

Every session node requires a regular runner turn and a clean, confirmed
closeout. **OpenCode nodes and all internal group members additionally require
business acceptance**: the closing `pages-report` must prove every todo and
criterion, with real evidence for criteria. A missing, invalid or incomplete
report fails these nodes and blocks successors. Read-only OpenCode nodes report
ticket todos because their credential cannot tick the checkboxes. YOLO ticket
todos must also be checked in Pages. Standalone Codex and Claude nodes retain
their existing diagnostic-only progress behavior. Runner failures, incomplete
turns, permission denials, timeouts, failed process exits, unavailable resources
and failed cleanup remain execution failures. No manual acceptance step is added.

After the turn, Pages rereads the authorized ticket checklists in both report
scopes and reconciles current requirements with the original report IDs. New or
edited requirements receive new IDs, so earlier evidence cannot prove different
work. A bound todo normally follows its current ticket checkbox; read-only
OpenCode nodes instead need the completed todo in their report. Without a ticket
entry, the report supplies the status. Open, missing
and unknown work remains visible, including when the report is absent. Criteria
keep the reported assessment, evidence diagnostics and current ticket checkbox.
For standalone Codex and Claude nodes, execution success makes no claim that
all business work was completed. OpenCode acceptance checks the report and
current checklist; it cannot independently prove the truth of reported evidence. Agents
may tick completed items under the existing server-side rights and optimistic
revision checks; after a conflict they reread and reconcile the current list.
A failure to authorize or read the ticket itself remains a technical error,
separate from a missing checklist entry or missing evidence.

The run view shows per node the runner, session mode, session and process
identity, times, actual process exit, closeout, requested and effective
configuration, diagnostic progress and a link to the original sent prompt. The
normalized **execution result** is `0` after regular completion and clean
closeout, and `-1` for technical failure or cancellation. Internal group turns
release the next step after regular turn completion, retaining the same native
session after accepted business progress; their process result remains pending
until its shared closeout. A
process crash is never inferred to be success from a favorable progress report.

The existing `completion` field selects only the progress scope: `report`
(default) describes todos and acceptance criteria; `todos` describes the current
todo list without criteria or synthetic defaults. Both scopes require an
accepted report for OpenCode and group members; other standalone nodes retain
diagnostic progress. In the todo scope, a writing agent moves the ticket to
in-progress, ticks completed todos live and moves it to review when all current
todos are done. Read only cannot change tickets. Legacy OpenCode workspace-write
settings require an explicit mode choice before a new run; saved model IDs and
historical results are not rewritten.

Run status distinguishes Running, Pausing, stable Paused, Stopping, Succeeded,
Failed and Cancelled. Blocked details explain validation failures and execution
errors. **Pause** closes the dispatch gate: queued work yields without starting,
while every dispatched branch and console turn drains. Only then is the full
stable-ID frontier persisted and editing enabled. Failures remain failures;
terminal End markers acknowledge completed work without a pointless Resume.
**Resume** reauthorizes the executor and prepares the saved plan revision.
It atomically checks the paused boundary and current draft revision, reserves
any additional writing copies, and appends an immutable continuation basis in
`agent_plan_continuations` (migration 060). The original snapshot, successful
step contracts, inputs and results remain unchanged. The panel distinguishes
unsaved edits, the saved draft revision and the adopted continuation revision.
Changed pending inputs and connections apply to the same run without replay.
Edits to already completed node configurations only affect a new Play run.
Deleting a required frontier node blocks Resume with a restart explanation;
changing dependencies of completed work also requires a restart. Existing
group sessions retain their runtime identity; incompatible changes are refused.
A paused run cannot move to another project or workspace through Resume.
**Stop** persists its irreversible request first, exposes closeout while owned
work settles, and releases reservations only after confirmed cleanup. An
unconfirmed closeout remains a visible failure and keeps its reservations.
Stopping never rolls back external changes. Reload preserves server state.
After a server interruption, unfinished runs are marked failed
rather than silently replaying work; processes and MCP credentials the
interrupted sessions left behind are ended at startup. These scans skip
unreadable processes of the server account that started before the run, such
as its service manager; a later unreadable process keeps the cleanup
unconfirmed. A new run is an explicit action. Historical runs that failed only
because of report or business findings retain their stored failure and blocked
successors. They are not rewritten or restarted. Resume applies only to an
active paused run and does not retry failed nodes; an ended historical run
requires an explicitly started new Play run, which uses the current
diagnostic-only completion rule.

Plans may be private, global, or shared with Pages groups and departments
using OR/AND membership. Global sharing still requires access to the plan's
project and workspace. Only the owner and the members and leaders of the plan's team may edit or start a run;
everyone else a plan is shared with only reads it. A department target of a share
matches members and leaders alike. Every executor needs their own
current agent/model and ticket/wiki permissions; sharing never delegates
credentials. Only the executor may read, pause, resume or stop their run, and
resource access is rechecked on the server before execution and disclosure.

### Team plans and templates (PAGE-118)

A person who is a member or the leader of exactly one department creates plans
and node templates for the team of that department. Leading a department
(`managed_departments`) counts like being a member (`department_members`) here
and only in the agent plan area: the union of both relations decides, each
department once, so someone who is member and leader of the same department
belongs to one department, while a member of one and leader of another belongs
to two. The department is stored with the object when it is created and is never
derived again from whoever saves it later. A person with no or several
departments creates objects without a team, which stay as private as before; no
department is guessed for them.

- **Access.** The members and leaders of the department who can also open the
  project of the plan read, change and run the same plan, and list and insert the same
  templates in the Templates tab (after a normal reload; there is no live
  co-editing). Both conditions are checked again on every server operation and
  for every access path: the plan page, the Agent API, MCP and Pica. A project
  access alone, a membership or leadership alone, and an administrator role
  never count (an administrator who neither belongs to nor leads the department
  has no access to its plans; project access itself stays as the project rules
  define it, so a leader who is not a member of a department-bound project needs
  that access from elsewhere). The existing share of a plan with departments
  reads the same departments: a leader matches a department target without the
  `manage_users` capability that sharing an agent asks for. A revoked membership or leadership, a revoked project access or a
  deactivated account takes effect in an editor that is already open: its next
  save is refused. Templates stored before PAGE-118 have no team and stay
  personal.
- **Plans of before teams.** Migration 062 marks the plans that exist when it
  runs (`legacy_share_pending`; plans created later are never marked). Each
  server start decides the marked plans once with the rule that applies when a
  plan is created: an owner who now belongs (as member or leader) to exactly one department brings
  the plan into that department, and it is a normal team plan afterwards
  (owner, revision, content, runs and the recorded editor unchanged). An owner
  without a department keeps the plan marked, so a later start shares it once
  the owner has joined or leads one; an owner with several distinct departments keeps it private
  and the mark is dropped (no department is guessed), as does a name the
  department already uses in the project. Nothing is renamed, merged or deleted.
  Plans competing for one name in one department are decided by ascending plan
  ID, so the smallest ID wins; plan IDs are random and no creation time is
  stored, so this is only reproducible, not a judgement of age. A plan created
  after the migration is never shared retroactively. The step is idempotent and
  logs only counts; a failure never stops the server from starting.
- **Saving.** A save by another member raises the revision of the same plan; plan
  ID, owner, team and project stay. Every team member may also change the
  workspace of the plan to another workspace **of the same project** that the
  person may use (checked for the person who saves, never through the owner's
  access) and may change the usage and the share, with the same validation as
  the owner; a share only lets others read the plan, never change it. Moving
  the plan to a workspace of **another project** and deleting the plan stay with
  the owner: project and department form the shared area and the name space,
  so a move would shift who sees the plan and which names it collides with
  (`plan_project_owner_only`, HTTP 403). The plan page has no share editor, so
  the share is changed through the Agent API, MCP and Pica; a save from the plan
  page carries the share unchanged. Runs, workspace reservations and the
  pause rules are unchanged: a paused run keeps its original workspace and
  cannot resume on a plan that was moved. The person who saved
  last is recorded (`updated_by`, `updated_at` of `agent_plans`) and not shown. A
  stale revision is a conflict that overwrites nothing and copies nothing; the
  editor offers to reload the plan and asks before it drops unsaved edits.
- **Names.** The name of a plan is compared trimmed, NFC-normalized and without
  case (`agentPlanNameKey`), by the plan page as an early warning, by the server
  and by a unique index on project, department and normalized name. Two plans of
  one team and project cannot share a name, whoever created them; a parallel
  creation or rename has exactly one winner, and the other gets a localized
  message at the name field (`plan_name_taken`) that names no plan, department or
  person. Nothing is renamed or numbered. Plans without a team are outside this
  rule, so existing duplicates stay as they are and cannot make the migration
  fail; a legacy plan whose name a team already uses stays without a team. Template
  names stay unique per owner, as before.
- **Credentials.** A team never lends access. Whoever saves or starts a plan needs
  their own current agent, model, ticket and wiki rights; there is no fallback to
  the creator or the last editor, and every run belongs to the person who
  started it.

### React Flow migration inventory and acceptance (PAGE-87)

The inventory below is from the domain definitions, editor, input readers,
repository, permission service and run views on the PAGE-86 base. It describes
the preserved contracts, not a claim that a live database roundtrip was run.

| Model or behavior | Preserved contract |
| --- | --- |
| Start / End | Stored IDs and coordinates; only Flow OUT / IN respectively; completed checkpoints turn green, other checkpoints stay neutral. |
| Agent | Independent configuration (name/revision, model grant, model, provider, reasoning, complete template and run options), personal assignment, instruction, completion scope and bindings. |
| Ticket | Task reference and live workflow badge; a value source with no flow ports; legacy ticket-to-text bindings remain supported. |
| Parameter | Name, format (string/number/JSON), typed text/number/ticket/workspace/wiki value and data output. |
| Variable | Legacy named global text value and data output. |
| Group | Name, position, ordered membership records, member-relative coordinates, explicit internal edges (or existing legacy-chain reading), retained legacy boundary metadata, direct member bindings and shared-session display. |
| Flow | Outer and internal edges remain separate; only same-level flow ports connect; duplicate edges and cycles are refused. |
| Data | Literal bindings stay in the model; source bindings refer directly to value nodes; legacy group aliases are resolved on read; result bindings retain predecessor/path requirements. Data never becomes a scheduling edge. |
| Editing | Existing source filters, button/drag insertion, copied template defaults, movement, selection, node dialog, inspector, group assignment/removal choice, disconnect and node removal remain attached to domain actions. Double-click still opens the PAGE-86 node/group console. |
| Runs | Waiting/running/succeeded/failed/paused/cancelled, blocked/cancellation diagnostics, group sessions, historical runs, progress, console and run controls keep their existing meanings. |
| Access and persistence | Owner-only editing, executor-only run access, server authorization, optimistic revisions, Save/Play payloads, dirty-draft leave guard, in-flight edit preservation and run polling retain their existing implementations. |

`plan-flow-model.ts` is a one-way rendering projection, not a new save format.
It keeps references to Pages domain nodes and maps members to React Flow
`parentId` with the existing member-area offset. A committed move uses the
existing move/place actions; connection events use the existing domain validator
with an explicit source and target, avoiding a state-update race between
starting and completing a connection. Measurements, drag previews, selection
metadata, viewport and MiniMap state never enter the saved plan. Opening or
polling a plan performs no layout or replacement of pinned configurations.
No schema, backend execution, scheduler, authorization or Mastra change is part
of this migration. Project/milestone diagram implementations remain unchanged.

Source comparison of the implemented interface (not screenshot evidence):

| Before PAGE-87 | After PAGE-87 |
| --- | --- |
| Custom transformed canvas, pointer gestures and SVG curves | React Flow canvas, measured handles, native dragging, zoom/fit controls and MiniMap |
| Floating configuration/source/run panels over a fading raster | Framed canvas with separate configuration, selection/source and run areas; collapsible narrow-screen panels |
| Node title/type and custom port buttons | Symbol plus type/title hierarchy, semantic type border, existing run badge, 24px pointer handles and keyboard port buttons |
| Custom curves for both connection kinds | Solid flow curves, dashed data paths, direction markers, named chips and a connection inspector |
| Selection details inside the tab of the selected type | One inspector above independently usable source tabs; explicit draft/save/read-only/loading feedback |

The superseded plan SVG renderer, line-action positioning, pointer/link/move
gesture hooks and viewport implementation are removed. Shared domain editing,
source dropping, geometry for group membership and the keyboard deletion guard
remain because they enforce Pages behavior rather than implement a parallel
canvas engine. React Flow 12.12.0 is pinned; its declared React/React DOM peers
accept the repository's React 19 versions. The library supports
[SSR](https://reactflow.dev/learn/advanced-use/ssr-ssg-configuration): the provider
receives the initial graph and nodes have initial dimensions; client hydration
measures their handles and draws the edges. The Pages static type gate checks
the integration against the installed types.
PAGE-87 used the free built-in components and attribution and linked the MIT
notice from canvas help; PAGE-102 replaced them with the zoom bar, hid the
attribution and keeps the notice with the source (see License).

Verification boundaries on 2026-10-17:

- Final static gates: `pnpm run check` exited **0** (React Router typegen,
  `tsc --noEmit`, `prettier --check .`); the subsequent
  `node --max-old-space-size=3072 node_modules/eslint/bin/eslint.js . --max-warnings=0`
  exited **0**. These results establish no runtime or visual acceptance.
- Only the required static `check` (route type generation, TypeScript and
  Prettier) and ESLint gates are run. Existing tests remain unchanged; no tests,
  coverage, harness, build, provider/model call or real agent execution is run.
- Read-only port inspection found existing listeners on both 3000 and 3100.
  Neither is started, stopped, replaced or used for mutations. The current
  task forbids server changes and test runs, and an existing 3100 listener is
  not evidence that it serves this implementation from an isolated snapshot.
- No database is opened/copied/migrated, no test-user credential is read, and
  no external service or original dataset is changed.
- TODO 1 (inventory), 2 (dependency/license) and 8 (old renderer removal and
  affected documentation) are implemented. TODO 3–6 have their code changes,
  but their live acceptance remains open: actual save/reload comparison of
  larger plans, all editing/connection/group actions, read-only gestures,
  conflict/in-flight-edit handling and status-update viewport stability.
- TODO 7 is **not performed**: login to a task-owned isolated copy, browser
  console inspection, Light/Dark and desktop/tablet/narrow visual inspection,
  keyboard/pointer checks and real before/after screenshots are outstanding.
  No screenshots or successful runtime/model execution are inferred from the
  source comparison or the static gates. Existing tests that describe details
  of the former renderer have neither been adapted nor executed in this task.

### Restart and resume after a disturbance (PAGE-127)

When the newest run of a plan failed or was stopped, its executor sees a
**Recover the run** section in the run panel: the state (recoverable,
interrupted by a server stop, failure not classified, stopped on purpose), the
failure point with its reason, the last verified checkpoint, the plan revision
the run executed and the one saved now, the origin of a run that came from an
earlier one, and every concrete blocker. Two separate actions follow:

- **Start from the start** creates a new run with a new identity from the
  saved revision shown on the button. The earlier run, its results,
  checkpoints and journal stay unchanged and link to the new run. Files and
  branches are not reset; the executor confirms that every node runs again,
  including actions that may already have taken effect.
- **Continue from the last safe state** creates a new run linked to the
  earlier one. Successful results whose checkpoint names the same output
  digest are taken over unchanged; nothing else counts as done. Only open,
  failed or interrupted work runs again, each as a new attempt with the saved
  revision, which must keep every completed node, its dependencies, its group
  and every started loop unchanged (`plan_completed_changed`). A loop keeps its
  completed iterations and the completed members of its unfinished iteration.
  Every node that had started — an agent session or a script process — needs
  the executor's explicit reviewed decision first (`review_required`); its
  prompt then begins with a recovery notice. **Continue the earlier agent
  session** is offered only where the adapter announced `session/resume`, the
  session ID is known and the profile keeps sessions on disk: Codex plan nodes
  and Pica; Claude Code plan nodes run with `persistSession: false` and loops
  start fresh sessions, so they offer **New attempt** only. A refused
  native resume fails the node visibly (`acp_session_resume_failed`); there is
  no silent fallback. A run stopped on purpose can also continue through this
  reviewed action; the stopped original stays unchanged. Only the newest run
  of a plan can be continued, once.

Before anything starts, current plan, agent, workspace, ticket and asset
rights are checked again and processes of the earlier run must be proven
gone: every session and script whose end was not confirmed is ended by its own
tag and unit, then its working copies and ACP leases are released; otherwise
the action fails with `cleanup_unconfirmed` and nothing starts. **Release**
does this alone. A server shutdown records running work as interrupted;
nothing is resumed automatically at startup.

Agent Plan retries known temporary provider failures up to ten times with
increasing delays. An exhausted quota with an explicit reset waits until one
minute after that reset; an unknown reset stays blocked. The run details retain
the attempts, cause and scheduled time. Routing never switches models. Shared
native sessions and attempts with tool activity require reviewed recovery
instead of an automatic replay. See the [plan retry contract](backend/service/agents/PlanRetries.md).

`POST /agent-api/plan-runs/:runId/recovery` accepts the same actions with the
run's current recovery `revision` and an idempotency key:
`{"action":"restart","revision":4,"confirmRepeat":true}`,
`{"action":"resume","mode":"native_resume"|"new_session","reviewedStepIds":[…]}`
or `{"action":"release"}`. The decision is journaled in the transaction that
creates the new run; a repeated key returns the first result, an older
revision is refused, and a plan with an active run starts nothing second. The
answer names the new run (`runId`). `GET` on the same path returns the view
the panel shows.

### Plans over MCP and in the Pica chat

MCP clients and Pica reach the same plans under the same rules: list and read
visible plans with their nodes, connections and status (`idle`, `running` or
`paused`, latest run, and whether the plan could start), create plans, change
their structure (nodes, flow connections and agent inputs) and their parameter
nodes one by one, list one's own runs of a plan newest or oldest first in pages,
select the newest, the first or a named run, and read the reports of a run, each
tied to its run and node. Only the owner and the members and leaders of the plan's team
change a plan, its share and its workspace within the project (another project and deleting only the owner); a hidden plan answers
like a missing one, and runs stay private to the person who started them. Pica
finds a plan by name, asks back when several match, shows run dates and statuses
in plain words, and cannot start, stop or delete plans. The tools and their
errors are listed in the
[MCP reference](./mcp/README.md#agent-plans).

### External MCP over stdio and HTTP

External clients may use the client-started stdio adapter or the opt-in central
`/mcp` Streamable HTTP endpoint of the existing Pages server. Both use shared
tools and current personal authorization. HTTP supports OAuth discovery, public
registration and Authorization Code with S256 PKCE, plus the existing explicit
browser code-pairing flow through `/mcp-login`. Personal connections, expiry,
last usage and revocation appear under Settings → Connections. Pica retains its
native tools and internal job-token bridge, with no external OAuth dependency.

Configure the optional `listenAddress` and `[mcpHttp].publicUrl` in the existing
TOML file; keep listener address, public HTTPS origin and trusted reverse proxies
separate. HTTP is limited to loopback. See the [MCP configuration, protocol,
authorization and client instructions](./mcp/README.md#central-http-mcp-and-personal-authorization)
for concrete settings, lifetimes and supported boundaries. No production proxy,
TLS, database or deployment changes are part of enabling this source feature.

## Getting started

### Requirements

- **Node.js 22.22 or newer** (`engines.node`). CI uses Node.js 24.
- **pnpm**: the repository pins `pnpm@11.23.0` in `packageManager`;
  `engines.pnpm` accepts 10 or newer.

### Install and run

```sh
git clone https://github.com/gesus90/Pages.git
cd Pages
pnpm install
pnpm run dev
```

The development server listens on <http://localhost:5173> by default and prints
the address it actually uses.

`pnpm install` only accepts package versions that were published at least ten
days ago (`minimumReleaseAge` in `pnpm-workspace.yaml`).

The `mcp/` folder is a separate package with its own manifest and lockfile.
`pnpm run lint` also checks its source with type information, so install its
dependencies once as CI does (also required on the builder for the shipped Pages MCP artifact):

```sh
pnpm --dir mcp install
```

### Agent Tool & Runtime Manager (PAGE-69)

**Settings → Agents → Tools** is available only to an active personal system
administrator in admin mode. Every loader and action rechecks persisted rights;
mutations also require the same origin. Status reads poll cached metadata and
never install or execute tools. Opening a page is not a model test.

The fixed registry manages Codex CLI **0.160.0**, Claude Code **2.1.293**,
OpenCode **1.18.34**, Codex ACP **2.2.2** (adoption also accepts **2.1.1**), and
Playwright MCP **0.0.83**. Playwright MCP itself pins
`playwright@1.64.0-alpha-1790635538000`; its browser revision is used for Chromium
and optional Firefox. The selected versions were checked against the actual
npm registry; see [registry evidence](./evidence/registry.json). The existing
protocol-driver ranges remain available to standalone consumers. There are no
new Pages library dependencies.

Tools, npm cache, probe home, enablement and release pointers live in
`<directory containing config.toml>/tools/`. Saved connection credentials remain
in the existing data directory. The service account needs write access to this
instance-owned tools directory, a supported Node/npm installation and outbound
access to the official npm registry and Playwright browser CDN. It receives no
additional host privileges. npm dependency scripts are disabled; the fixed
Claude/OpenCode package setup scripts run separately in the private home.

Each install, repair and update creates a separate generation and verifies it
before an atomic activation. Failed candidates are discarded; the previous
working release and login files stay intact. Explicit rollback health-checks the
previous generation before publishing it. An update already at its approved
target is a no-op. Active sessions keep their original paths; removal is blocked
while a session, login, text request, probe or uncertain cleanup uses the tool.
Old generations remain until an explicit managed removal; operators should
monitor disk usage. Removal affects only the selected tool's managed directory,
never system packages or logins. A required removed tool is installed again on
its next use. At startup, managed tools can automatically move to a newly
reviewed registry target after a successful probe. An explicit rollback records
that target and remains in place across restarts until a different target is
reviewed. Compatible adopted system tools remain untouched by automatic updates.
Admins can also trigger an update explicitly. There is no periodic registry
polling; adding an approved target is a reviewed source change, with no
uncontrolled major upgrade.

After listening, Pages reconstructs required dependencies from active CLI
connections and saved optional integrations in the background. It checks local
sign-ins without a model request. Other Pages features remain available while
optional checks fail. Native runs wait for readiness, including an executable
CLI, approved adapter, workspace, functional bubblewrap and required MCP/browser
components. The existing ACP handshake still confirms the exact model, effort
and permission mode before the prompt. No provider, model or runner fallback is
introduced. Readiness failures appear in run events and the Tools inventory.
A local sign-in check cannot establish remote subscription entitlement or token
validity; the existing model test remains an explicit operation.

Playwright requires both **Enable integration** on its Tools card and **Allow
Playwright browser tools** in the agent's YOLO configuration. Read-only agents
and Pica receive no browser grant. Group members must agree on this permission.
Chromium is provided proactively; MCP runs headless with an isolated profile,
keeps its sandbox enabled, saves sessions and screenshots under the workspace's
`.pages-artifacts/<session>/`, and inherits the existing process ownership tag.
Use a separate authorized test instance and test data. Playwright's URL filtering
is not treated as a security boundary. Firefox can be provisioned and tested,
but plan sessions currently select Chromium.

A model-free health check initializes ACP without creating a session; Playwright
MCP initialization also confirms a nonempty tool catalog. The Pages production build runs the independent MCP package build and ships
`pages-mcp-v<version>.cjs` next to the server entry; runtime installation of that
private package is unnecessary. The MCP test suite stays independent. Pages MCP initialization
checks its bundled version without a real token or API request; authorized
session startup and the existing MCP readiness machinery perform the later
credential-scoped checks. Browser checks actually launch/close a headless browser;
bubblewrap checks actually create a namespace. Installed, ready and running are
separate inventory facts. Checks have bounded deadlines; they expose safe
structured diagnoses, never raw npm output, prompts or secrets.

#### Linux provisioning and container deployment

Node **>=22.22.0** is a prerequisite for Pages itself. Native agent tools use
the standalone Pages MCP package, whose declared runtime minimum is **Node 24**;
the tool manager enforces that requirement. Node must be supplied by the
operator from a trusted distribution. Pages cannot replace the runtime of
its own running process. npm must be available on the service PATH. Bubblewrap
and browser system libraries require a separate authorized host setup; the web
process never runs a host package manager or changes kernel/security policy.

`scripts/provision-agent-tools.sh` prints a fixed reviewed package plan by
default for Debian 12 and Ubuntu 24.04. Only an operator's explicit `--apply`
invocation in a privileged setup context installs these OS packages. Review it
before use. Unsupported distributions stop with a diagnosis and require their
own authorized OS provisioning. The script is never called from the UI. After
provisioning, run **Test functionality** as the ordinary Pages service account.
A binary alone does not establish working namespaces or browser libraries.

No Docker deployment was previously supplied by this repository. For a custom
container image, install these OS libraries at image build time (for example in
a supported Debian-based official Node image), then switch to a non-root runtime
user. Pin and verify the chosen base image digest in the deployment. Persist the
instance directory, including `tools/`, the main configuration, data, instance
secret and saved logins; preserve ownership and never copy credential directories
into the image. Mount workspaces separately from instance data. The runtime
container must support the existing unprivileged bubblewrap and browser
sandboxes; restricted environments produce a readiness refusal. No privileged
container, disabled seccomp profile or sandbox bypass is a supported repair.

On new installation, configure the instance and its CLI connections normally;
startup/preflight supplies approved managed packages. After restart, persisted
release pointers are checked and reused rather than installed globally. After a
Pages update, startup can apply newly reviewed registry targets; review these
changes before deployment and use controlled Update/Rollback when needed.
For read-only/offline hosts, provision compatible trusted system tools or populate
the instance's managed tools in an authorized connected staging environment and
verify health on the target. Missing npm, network access, write permissions,
external Claude ACP, system libraries or namespaces remain concrete operator
diagnoses. Cleanup uncertainty stays pinned by the existing ACP recovery journal
and blocks destructive maintenance until a later startup confirms cleanup.

### Native ACP resource scheduling (PAGE-81)

One instance-wide `AcpResourceScheduler` admits Codex (`codex-acp`),
Claude Code (`claude-agent-acp`) and native OpenCode (`opencode acp`). The existing DAG still determines which
steps are executable. ACP admission has a separate shared FIFO queue; queued
steps have no native ACP process and do not occupy the DAG's two non-ACP
execution slots. API work retains its existing request execution path.

Optional flat keys in the instance's `config.toml` (manual edits apply after restart):

```toml
maxConcurrentAcpSessions = 2  # 0–999; 0 = unlimited up to the absolute ceiling of 999
memoryAwareScheduling = true
minimumAvailableMemory = 2048 # MiB, Linux MemAvailable
acpIdleTimeout = 300000       # milliseconds between native turns
queueDiscipline = "fifo"
```

`PAGES_MAX_CONCURRENT_ACP_SESSIONS`, `PAGES_ACP_MEMORY_AWARE` (`true`/`false`
or `1`/`0`) and `PAGES_ACP_MIN_AVAILABLE_MEMORY_MB` override the first three
settings. Invalid settings refuse startup. With memory checks enabled, a
missing measurement or RAM below the reserve blocks new starts. Waiters are
rechecked every second without another user action. The reserve is a start
threshold, not a prediction of a model's future consumption.

Without an explicit concurrency setting the default is **2**; an existing saved
value, including **1**, is preserved. In **Settings → System → ACP resources**,
an active administrator in admin mode can save a whole number from **0 to 999**.
The change is persisted to the instance configuration and applied to the shared
Pica/Agent Plans scheduler immediately. Raising the limit wakes eligible FIFO
waiters without resubmission; lowering it preserves every occupied lease and
waiter. **0** displays as **Unlimited (max. 999)** and keeps RAM, cleanup and
recovery checks active. The ceiling does not imply hardware capacity for 999
processes. When `PAGES_MAX_CONCURRENT_ACP_SESSIONS` controls admission, the card
shows that source and disables edits; direct form submissions are refused too.

Starting, running, paused-but-existing, idle and uncertain native sessions
all occupy capacity. A DuckDB lease is committed before the first start
operation and removed only after confirmed process-tree closeout. Group
continuation uses the original lease and native process. Paused waiters keep
their FIFO position among eligible requests; pausing never frees a live lease.
Cancelling a queued node removes it without starting its adapter. Node deadlines
include waiting time.

An idle native session, including a paused group, is closed after five minutes
by default. A follow-up started by the adapter through steering is active work,
so it remains under the owning job deadline until Pages closes it or starts
the next prompt; idle expiry does not interrupt that follow-up. Its run record receives the retirement reason and closing outcome.
Resume after expiry fails with `plan_context_changed`; Pages does not silently
start a replacement or replay accepted steps. A failed or unconfirmed cleanup
continues to occupy capacity, visibly, even beyond the idle timeout.

At startup Pages cleans durable leases before admitting work, including a
crash between reservation and recording the process start. Existing run recovery
marks interrupted work failed and never retries it. Interrupted sessions from
before this journal existed are adopted from active runs and retained workspace
reservations, so an upgrade also accounts for their cleanup failures. Shutdown cancels waiters,
drains runs and closes native sessions; a run that the shutdown ends is
recorded as interrupted, not as stopped by its executor, so it can be resumed
after the restart (PAGE-127). Cleanup uses the inherited
`PAGES_RUN_INSTANCE` tag, also for helpers outside the adapter's process group;
an unreadable process scan cannot prove absence. Unresponsive process exit
returns an unconfirmed closeout after bounded waits. Cleanup failures and
uncertain journal writes fail closed; retained leases are retried during the
next normal startup. While a request waits only because uncertain leases hold
the capacity, Pages checks them again at most once a minute by their own
instance tag and worker unit and releases each one whose processes are proven
gone (PAGE-127); an unconfirmed lease keeps its capacity. There is no
force-release UI.

The shared **ACP resources** card in Settings → System
polls `/agent-api/resources` every five seconds while open and refreshes after
a confirmed limit change. It shows global occupied leases, the effective limit,
its source and the combined Pica/Agent Plans queue.
The endpoint rechecks an active personal administrator in admin mode on every
request and uses `no-store`. It shows occupied sessions, waiting reasons,
current available RAM, paused blockers and failed cleanup, and names each
credential leftover whose cleanup the last start could not confirm, with what
clears it. It exposes no prompts, workspace paths, credentials or native
conversation identifiers.

This change uses the existing Pages runtime and DuckDB. It does not install
Mastra Core or introduce another workflow engine. The Mastra integration named
in PAGE-81's title remains deferred; the native resource scheduler is independent
of a future orchestration framework.

### Limited worker units (PAGE-127)

Every ACP worker — the adapter, its CLI runner, the MCP bridge and every
helper they start — runs inside the bubblewrap namespace **and** in a
transient unit of the server account's systemd user manager, named
`pages-acp-<instance>-<random>.service` in `pages-acp.slice`. The unit is a
cgroup of its own with hard limits:

| Limit | Value | Why |
| --- | --- | --- |
| `MemoryMax` | 1536 MiB | measured peaks were ≤ 430 MiB (Codex, Claude Code) and ≤ 810 MiB (OpenCode); two workers stay far below what the 8 GiB host can lose |
| `MemorySwapMax` | 256 MiB | a growing worker fails itself instead of slowing the host |
| `TasksMax` | 512 | processes and threads of the whole worker tree; measured ≤ 100 |
| `CPUQuota` | 200 % | at most two of four cores |
| `RuntimeMaxSec` | node deadline + 120 s, else 24 h | a backstop if Pages itself hangs |
| `OOMPolicy=kill` | — | an exceeded limit ends the whole worker, inside its cgroup only |

The kernel ends a worker that exceeds its memory inside that cgroup
(`CONSTRAINT_MEMCG`), so neither the gateway nor Pages meet the global OOM
killer for it; the node or Pica job fails visibly with `acp_worker_limit`.
A worker whose output holds a line longer than 4 Mi characters, with or
without a line break, is ended the same way: the line and everything after it
are discarded, and the job fails with `acp_output_overflow` instead of
continuing on a truncated or oversized frame.
Values reach the worker through a 0600 environment file in
`<data>/worker-units/`, removed once the worker started, never through an
argument list. The manager's own variables — session bus, SSH and GPG agents,
runtime directory — are removed, and the namespace hides `/run/user/<uid>`,
so no socket of the account's service manager, desktop bus or SSH agent is
reachable from inside. Stop, timeout and cleanup signal the unit by its name,
which carries the session's random instance tag: ownership is the unit's
cgroup, never a process ID, and helpers that left the process group are
included.

Pica never starts without a unit (`acp_worker_unit_unavailable`, no model is
called). Plan nodes use the unit wherever the service manager provides one and
otherwise start as before, with one warning. The unit works the same whether
Pages runs as a system or as a user service, because the user manager starts
the process itself; the server account needs a running user manager
(`loginctl enable-linger <account>`), reached through `/run/user/<uid>/bus`.
`systemctl --user list-units 'pages-acp-*'` lists the live workers.

When DuckDB reports that a fatal error invalidated the open database, Pages
ends with exit code 1 (`database_invalidated`) instead of answering without a
usable database; the service manager starts it again and the startup recovery
records interrupted runs as resumable. Observed in PAGE-127 only after hard
kills of a test instance (`Failed to delete all rows from index` on
`chat_sessions`); rebuilding the affected index (`DROP INDEX … ; CREATE INDEX
…; CHECKPOINT;` with the server stopped) repaired the file.

### OpenCode plan nodes with a Console / Zen key (PAGE-66)

Pages manages the verified native OpenCode **1.18.34** under the instance's
`tools/` directory. Create an active OpenCode connection or use **Settings →
Agents → Tools → Install**. No global npm installation or separate OpenCode ACP
adapter is needed. A compatible trusted system installation can be adopted;
otherwise Pages installs its approved version locally. The service needs Node
and npm from operator provisioning; a login shell's nvm setup alone does not
configure a systemd service.

Both OpenCode plan modes require Linux bubblewrap at `/usr/bin/bwrap` and working
unprivileged user namespaces for the service account. Install it through the
host's package manager (`apt install bubblewrap` on Debian/Ubuntu). A file-only
installation check does not prove that namespaces work: Pages performs its
existing isolated probe on an actual start. `PAGES_CLI_ISOLATION=required` also
makes isolation mandatory for the other CLI paths. Register an authorized
workspace, optionally narrow its roots with `PAGES_WORKSPACE_ROOTS`, and provide
the existing Pages MCP bundle and instance URL as for the other ACP runners.
OpenCode's native internal HTTP listener uses loopback, an ephemeral port and a
fresh process password. No fixed OpenCode server or IDE session is reused.

In **Settings → Agents**, create an **OpenCode** connection, select
**OpenCode Console / Zen (opencode)** in its key form and enter the key obtained
from OpenCode Console / Zen. No Codex or Claude login and no OpenRouter key is
required. For an OpenRouter key, explicitly select **OpenRouter (openrouter)**.
The destination is never guessed from a key's prefix. A provider change requires
explicitly saving that provider with its matching key; old model IDs remain
unchanged and must be reselected explicitly when they no longer match.

The inspected package identifies Zen as provider **`opencode`**, with native
API credentials shaped as `{"opencode":{"type":"api","key":"<redacted>"}}`;
OpenRouter uses the distinct `openrouter` entry. This is confirmed by the
installed binary and the versioned [native auth source](https://github.com/anomalyco/opencode/blob/v1.18.34/packages/opencode/src/auth/index.ts)
and [provider source](https://github.com/anomalyco/opencode/blob/v1.18.34/packages/opencode/src/provider/provider.ts).
New keys are stored in
`<data>/agents/<connection-id>/opencode/opencode/auth.pages.encrypted`, with
owner-only directories and file mode 0600. The existing `InstanceSecretCipher`
uses AES-256-GCM and binds the encrypted native JSON to the connection ID. Back
up the existing instance secret with the data; another instance cannot decrypt
this file. OpenCode receives the JSON only through `OPENCODE_AUTH_CONTENT` in
its isolated child environment, never through arguments or the prompt. Pages
does not require an `OPENCODE_API_KEY` in the service environment. Known runtime
keys, MCP tokens and the process password are redacted before run persistence.

Existing native `auth.json` files remain readable with their original provider;
they are not reinterpreted or automatically migrated. Replacing a key through
the form writes the encrypted file atomically and removes the old plaintext
file. Removing the connection or logging out removes both formats. The local
access check confirms version, decryption and credential structure; it does not
prove remote key validity or available credits. The existing explicit **model
test** makes a provider request and may incur usage. Merely opening Settings
starts neither a CLI nor a model request.

The connection loads `opencode models <configured-provider> --verbose`. Catalog
entries keep the complete provider-prefixed ID: `opencode/<model>` for Zen,
`openrouter/<vendor>/<model>` for OpenRouter. Models and reasoning variants come
from this native catalog; no OpenRouter catalog is used to validate a Zen key.
The catalog lists provider capabilities, not a promise of account entitlement or
balance. The ACP session must offer and confirm the exact saved model, variant
and managed mode before receiving the resolved `AGENT.md`, node instruction,
parameters and Pages contract. Undeclared or remaining parameter placeholders
refuse the node. A leading slash in the agent text is sent as part of a Pages
assignment, so it cannot turn the whole plan prompt into a native slash command.
Internal helper and subagent models are pinned to the same model and variant;
there is no alternate model or `opencode run` fallback for plan steps.

OpenCode offers exactly the saved modes **Read only / Nur Lesen** (`read_only`)
and **YOLO** (`yolo`). Missing run options mean Read only. A saved
`workspace_write` configuration stays unchanged and cannot start until someone
chooses a mode; it is never promoted to YOLO. Read only uses native deny rules
for edits, commands, delegation and other changing tools, plus a read-only
workspace mount. Its Pages credential offers only reading operations and the
server checks every call. YOLO enables all tools available in native ACP and
the complete Pages MCP catalog authorized for the executor, without an extra
tool allowlist or user approval loop. Native explicit deny rules still apply;
Pages retains the explicit `*.env` and `*.env.*` read denials. Unexpected ACP
permission requests are refused in Read only and automatically approved in
YOLO only when an allow option exists. User/project OpenCode configuration,
external skills, default plugins, sharing and updates stay disabled or are
refused by the existing configuration guard. Pages installs no foreign plugin
or MCP server. Workspace, connection, project and Pages authorization boundaries
remain in force. Pica keeps its existing, narrower Pages-only profile.

The run records requested and confirmed model/variant, native mode, workspace,
effective permission rules, tool events, final answer, ACP session ID and process
closeout. OpenCode 1.18.34 reports the configured model selector, but no separate
provider-response model identity; `modelVerification` makes that limit explicit.
Its ACP registration path also lacks a verified model-free MCP readiness command;
Pages does not invent a connected status. Tool failures and acceptance remain
observable, and a real authorized Pages tool call is still part of manual
functional acceptance.

Native authentication failures, exhausted balance/quota, rate limits, unavailable
models, permission denial and generic ACP failures have distinct safe error
codes when OpenCode reports recognizable diagnostics. Unknown provider messages
remain a generic ACP failure without raw upstream text. Timeout and user stop
close the ACP channel and end only this task's tagged process group and helpers.
An uncertain cleanup keeps the native lease, connection mutation lock and
workspace reservation; retry occurs during normal startup recovery, with no
force-release UI. Other OpenCode/IDE sessions are never selected by name.
OpenCode nodes require a valid, completed `pages-report` and accepted business
progress as well as regular ACP completion and confirmed cleanup.

PAGE-66 validation inspects local version and release source and runs the static
Pages gates. It deliberately starts no server, model request or agent run and
adds no automated tests. Credentialed end-to-end behavior, account-specific
models, live MCP calls, cancellation and native tool effects remain for manual
functional acceptance.

### ACP adapters for the CLI runners

A Codex connection uses the instance-local Codex CLI and ACP adapter managed by
**Settings → Agents → Tools** (PAGE-69). Startup and native session preflight
install or repair approved missing dependencies; neither requires a global npm
installation. Compatible system tools under trusted system/Node installation
paths can be adopted. The manager's exact allowlist is narrower than the ACP
protocol driver's historical compatibility range below.

The existing Claude ACP adapter remains an externally provisioned dependency;
PAGE-69 adds no new Claude/OpenCode adapter. Pages continues to start its process
for each authorized session and use the connection's isolated sign-in.

| Runner      | Package                                  | Executable         | Pages accepts   | Verified with |
| ----------- | ---------------------------------------- | ------------------ | --------------- | ------------- |
| Codex CLI   | `@agentclientprotocol/codex-acp`         | `codex-acp`        | 2.1.1 up to 3.0 | 2.2.2         |
| Claude Code | `@agentclientprotocol/claude-agent-acp`  | `claude-agent-acp` | 0.90.x          | 0.90.0        |

For the external Claude adapter only, an operator can install the fixed package
into a dedicated directory owned by the service account and add its `.bin`
directory to the service PATH:

```sh
npm install --prefix /srv/pages-external-acp @agentclientprotocol/claude-agent-acp@0.90.0
# Add /srv/pages-external-acp/node_modules/.bin to the Pages service PATH.
```


The adapter packages a Claude CLI binary of its own, which Pages never uses:
it always points the adapter at the `claude` CLI of the host
(`CLAUDE_CODE_EXECUTABLE`), so the sign-in, the version and the catalog the
other Pages checks use are the ones the node runs with. The external Claude adapter is only
found when its folder is on the `PATH` of the running server; the service
needs no restart after installing it, because the executable is looked up at
every node start. Previews and other majors are refused. A 0.x adapter may
change with every minor version, so Pages accepts the next one only after it
was verified.

What Pages sets for a session, and nothing else:

- **Codex:** `CODEX_PATH` (the Codex CLI of the connection), `CODEX_CONFIG`
  (sign-in method, provider, shell and web switches of the mode),
  `INITIAL_AGENT_MODE`; the session mode `read-only` or `agent-full-access`,
  the model and the effort are confirmed before the prompt.
- **Claude Code:** `CLAUDE_CODE_EXECUTABLE`, the automatic model fallback and the
  remap of retired model names switched off, auto memory off; `session/new`
  carries the Claude options (`settingSources: []`, `strictMcpConfig`, the
  tool allowlist of Read only). The mode `default` or `bypassPermissions`, the
  model and the effort are confirmed before the prompt; the model the adapter
  reports with its first usage update must equal the stored one.

Check an installation, as the account of the Pages server and from the folder
of the repository, with a throw-away workspace:

```sh
pnpm acp:smoke --provider claude_code --data ~/.pages/data \
  --connection <connection id> --workspace /tmp/smoke-workspace \
  --mode read_only --model <exact model id> --effort low
```

It starts the node exactly like a plan does (connection sign-in, adapter,
isolation, mode), sends a short prompt and prints what the run record would
hold: adapter and model as reported, session mode, events, closing report and
whether any process of the session is left. `--stop-after <seconds>` stops the
node like the stop button, `--timeout <minutes>` applies a deadline,
`--mcp-bundle` and `--mcp-url` with `PAGES_SMOKE_TOKEN` connect a Pages MCP
server.

YOLO needs [bubblewrap](https://github.com/containers/bubblewrap)
with working unprivileged user namespaces for the server
account. The managed production path now requires it for every native ACP
session; a failed readiness check reports the tool and cause through
`agent_tool_not_ready`. Low-level standalone smoke runs still report
`plan_yolo_isolation_unavailable` for YOLO
before any process starts. Pages probes the isolation again a minute after a
failed probe, so installing bubblewrap needs no restart either.

Shared run notes have been removed (PAGE-80). Plan runs do not create notes
directories, step files or pause markers and do not add notes instructions or
filesystem access. Existing `{{@run.notes}}` occurrences in agent templates or
node instructions are reported as unsupported; their text is never replaced
or silently edited. Remove or revise them explicitly before starting a run.

Old directories under `~/.pages/temp/<planId>/<runId>/`, their contents and
sibling `<runId>.paused` markers remain untouched. Pages no longer cleans them
up automatically. Any later deletion requires separate operator approval.
Prompt and final-answer archiving keeps its existing behavior.

| Run record or error                                      | Cause and remedy                                                                 |
| -------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `agent_tool_not_ready` | The run events name a tool and concrete readiness cause; inspect Settings → Agents → Tools. |
| `plan_acp_adapter_missing`, `plan_claude_acp_adapter_missing` | Check the managed Codex installation, or the externally provisioned Claude ACP adapter. |
| `plan_acp_adapter_unsupported`, `plan_claude_acp_adapter_unsupported` | The run record names the installed adapter and the verified range. |
| `plan_yolo_isolation_unavailable`                        | bubblewrap is missing or user namespaces are off. Install or allow it.           |
| `plan_permission_mode_unenforceable`                     | The adapter did not offer or confirm the mode, for Claude Code for example a managed setting that disables `bypassPermissions`, or a server running as root. |
| `plan_model_unavailable`, `plan_reasoning_unsupported`   | The runner does not offer the stored model or effort. Choose another in the agent. |
| `codex_permission_mode_required`, `claude_permission_mode_required` | An agent saved with the earlier write mode needs a chosen mode.   |

### First start

On a fresh installation (`firstRun = true`), every page leads to the setup
wizard. Pages prints its one-time links directly to the operator console (stdout),
bypassing the logger:

```text
[pages] Pages is not set up yet. Open the setup wizard with this one-time link:
[pages]   http://localhost:3000/setup?token=<one-time-token>
```

The setup wizard asks for the company name, the first administrator account and
the database file. Only when it finishes does Pages create the database and mark
the setup as done. Open a link from the console in the browser. A restart issues a
new token; completing setup invalidates it. There is no setup-link handoff file.
The operator console is the only application output for this capability. It never
enters the daily JSONL files, logger console mirror or error fallback. Protect any
operator-managed stdout capture as carefully as the console itself.

### Configuration

Pages keeps its settings in `~/.pages/config.toml`, which it creates on the
first start. A finished setup looks like this (synthetic values):

```toml
firstRun = false
port = 3000
databasePath = "/home/dev/.pages/data/pages.duckdb"
logRetentionDays = 30
```

Setting `firstRun = true` opens the setup wizard again on the next start.

The optional key `picaMobilePort` (1–65535) opens the WebSocket endpoint of the
Pica Mobile app on that port. Administrators set it under Settings >
Connections > Pica Mobile; without the key Pages opens no extra port. See
[docs/PicaMobileWebSocket.md](./docs/PicaMobileWebSocket.md).

The production server (`pnpm run start`) listens on port 3000 by default.
Start parameters win over the file:

```sh
pnpm start --port 8080                     # stored in the configuration
pnpm start --config /srv/pages/config.toml # another configuration file
```

The development server always reads `~/.pages/config.toml`; start parameters
and the configured port do not apply to it.

Optional environment variables are documented in [`.env.example`](./.env.example).
Pages does not load a `.env` file by itself: export the variables in the shell
or service environment, or start the production server with
`node --env-file=.env server.mjs`.

### Behind a reverse proxy

A reverse proxy that ends TLS (Caddy, nginx, Traefik) hands requests to Pages
over plain HTTP. The browser still sends `Origin: https://…` with every form
post, and Pages refuses a post whose `Origin` is not the address of the
request, so signing in through the proxy fails with HTTP 400 until Pages
knows which proxy to believe. List the proxy in `config.toml` (a manual edit
that applies after a restart):

```toml
trustedProxies = ["127.0.0.1", "::1"] # addresses or ranges such as "172.18.0.0/16"
```

- An entry is the address Pages sees the proxy connect from, not the address
  of the people who use Pages. For a proxy in a container that is the address
  of the container or of its network. Host names and the range `/0` are
  refused: an invalid entry makes the server exit with code 1 at the start,
  like any other invalid key of `config.toml`.
- Only a connection from a listed address may say that the request was HTTPS,
  through `X-Forwarded-Proto: https`. Pages then compares `Origin` with the
  `https://` address; the comparison stays on for everyone. From any other
  address, and for any value but `http` or `https`, the header is ignored.
- The proxy has to set `X-Forwarded-Proto` itself to the protocol the browser
  used, replacing any value the browser sent, and has to pass the `Host` of
  the browser on. Caddy's `reverse_proxy` does both
  by default; nginx needs `proxy_set_header Host $http_host;` (it keeps a
  port such as `:1080`, which `$host` drops) and
  `proxy_set_header X-Forwarded-Proto $scheme;`.
- Without `trustedProxies`, no proxy is trusted and nothing changes for an
  installation that is reached directly or without TLS in front.

### Data and runtime directories

```text
~/.pages/
├── config.toml               configuration
├── log/                      private daily operational JSONL files
├── Agents/                   agent definitions and run records
└── data/                     default database location
    ├── pages.duckdb          database
    ├── github-token.key      instance key, unless PAGES_GITHUB_TOKEN_KEY is set
    ├── wiki-attachments/     wiki attachments
    ├── assets/               ticket attachments: <ticket-uuid>/<attachment-uuid>.<extension>
    ├── ticket-attachments/   legacy ticket files until the offline migration
    ├── themes/               design themes, one directory each (optional)
    └── agents/               isolated logins of CLI model connections
```

Ticket upload, inventory, backup and the verified offline migration of existing
attachments are described in [Ticket attachments](docs/TicketAssets.md).

`Agents/` sits next to `config.toml`. The key file and the folders below
`data/` always sit next to the database file, wherever `databasePath` points.

When Pages opens the database, it applies the numbered migrations from
`backend/database/migrations/` that the file has not seen yet. A schema
change is a new migration; Pages rejects an applied migration whose content
changed. DuckDB allows one writing process per file: a second server or another
tool cannot open the database while Pages runs.

### Design themes (PAGE-36)

A design theme changes the colors and surfaces of the whole interface for one
user. Every user chooses theirs in **Settings → Personal → Appearance**; the
choice is stored per user, independently of the color mode (light, dark,
system). Only the identifier of the theme is stored, and the color mode stays a
separate setting: **Light**, **Dark** and **System** above the theme cards pick
the palette of the chosen theme. Pages ships four themes, all built in and not
removable: `standard`, which looks as Pages always did, `arctic-ice`
(PAGE-129), a maritime ice-glass design with one white-and-blue palette for
light and one deep polar-sea palette for dark. Arctic Ice is one card with one
identifier; under **System** it follows the device color scheme, including
changes while Pages is open. Its only texture is a static, barely visible wave
pattern on the permanent sidebar (a gradient, no image, no blur, no animation);
content surfaces, tables and fields stay plain. `jungle-botanical` (PAGE-149)
is one additional card with light botanical and dark forest palettes, selected
by the same Light/Dark/System control. Its own tropical leaf silhouettes stay
in desktop and mobile navigation; content cards remain opaque and plain.
Navigation has separate contrast roles, including its selection and focus
colors. Botanical strengthens field edges and caps the lightness of user-colored
text on light surfaces without changing the stored color or its hue. Status,
priority, workflow and plan colors and colors that users picked keep their
meaning in every theme. `neural-rgb` (PAGE-150) is one card with light graphite-white
and dark graphite/navy palettes. Cyan actions, quiet violet selection edges and
static circuit traces in desktop and mobile navigation follow the same color
mode. Its opaque content cards carry only a subtle edge; the four dashboard
metric icons use decorative cyan, violet, magenta and blue roles. Fields and
selection have accessible contours. No theme animation is added. The sign-in page has no signed-in user and therefore
always uses the Standard design.

More themes are installed by putting a directory into `themes/` next to the
database file (`~/.pages/data/themes/` by default). No restart is needed: the
directory is read again whenever somebody opens the appearance settings, and a
theme that was edited or removed is noticed on the next page load. A removed
theme (and one whose manifest became invalid) is no longer offered, and users
who had chosen it see the Standard design until it is installed again; their
stored choice is kept. There is no upload in the interface.

```text
themes/
└── northern-lights/          the directory name is the identifier
    ├── theme.json            manifest (required)
    └── preview.png           preview image (optional, PNG/JPEG/WebP, up to 1 MiB)
```

```json
{
  "schemaVersion": 1,
  "id": "northern-lights",
  "name": { "de": "Nordlicht", "en": "Northern lights" },
  "description": { "de": "Kühle Blautöne.", "en": "Cool blues." },
  "modes": ["light", "dark"],
  "colors": {
    "light": { "background": "#eef6fb", "primary": "#0e7fb8" },
    "dark": { "background": "#0a1822", "primary": "#38bdf8" }
  },
  "materials": { "shadowStrength": 1.5, "shadowEdgeAlpha": 6 },
  "preview": "preview.png"
}
```

- `id`: lower-case words joined by hyphens, beginning with a letter, at most 40
  characters, equal to the directory name. The identifiers of the themes Pages
  ships (`standard`, `arctic-ice`, `jungle-botanical`) are reserved; a directory with one of them is
  skipped.
- `name` and `description` hold both languages; names have at most 48 and
  descriptions at most 200 characters.
- `modes` lists the supported color modes. A theme applies only while a mode it
  supports is in effect; in the other mode the Standard design stays.
- `colors` gives hexadecimal colors (`#rgb`, `#rrggbb`, `#rrggbbaa`) per mode.
  The roles are the color tokens `background`, `surface`, `surface-hover`,
  `card`, `sidebar`, `sidebar-hover`, `muted`, `foreground`,
  `muted-foreground`, `border`, `primary`, `primary-hover`, `primary-subtle`,
  `primary-foreground`, `ring`, `sidebar-active` (the selected entry of the
  sidebar), `field`, `field-border`, `field-border-hover` (input fields),
  `panel-body`, `auth-glow-warm`, `auth-glow-cool` and `auth-button-from` (the
  stage of the sign-in and pairing pages); a role that is left out keeps the
  Standard value. Pages turns the roles into custom properties itself; a
  manifest cannot carry CSS.
- `materials` (optional) sets `shadowStrength` (0 to 8; the Standard design uses
  1 in light and 4 in dark) and `shadowEdgeAlpha` (0 to 100, in percent).
- Unknown keys and values outside these ranges make the manifest invalid.
- The color of the browser's address bar (`theme-color`) follows the Standard
  palette in every theme.

A directory with an invalid manifest is skipped, never half applied. The reason
is written to the server log once (`Design theme directory "<name>" was
skipped: …`) and shown to administrators below the theme cards.

### Server logging (PAGE-67)

Pages uses Pino **10.4.0** behind `backend/logging/Logger.ts`. All six severities
(`trace`, `debug`, `info`, `warn`, `error`, `fatal`) enter the daily log without
sampling or a production minimum level. Existing server diagnostics also pass
through this interface; their operator-console mirror is sanitized centrally.
There is no global console interception. The independent `mcp/` adapter and
third-party processes retain their own logging boundaries.

Logs are UTF-8 JSON Lines: one JSON object followed by LF, with escaped newlines
in messages/stacks. Example: `~/.pages/log/pages-2026-10-17.jsonl`. `log/` is
always next to the selected configuration: `--config /srv/team/config.toml`
uses `/srv/team/log/`, regardless of the database path or working directory.
The directory uses mode 0700 and files 0600 on POSIX; symlinks at the managed
directory/file are refused. Logs are outside the public asset directory and
are never offered through an HTTP log/download endpoint or a client bundle.

Each record carries `schemaVersion: 1`, UTC `time` with millisecond precision
(`...Z`), `severity`, stable `event`, `component`, `message`, `pid` and a random
process `instanceId`. AsyncLocalStorage carries request/correlation, run, job
and attempt IDs when those boundaries apply. HTTP responses expose the server's
generated `X-Request-ID`; inbound IDs are not trusted. Errors have an `errorId`,
type, safe message, code, stackframes and a bounded cause chain. Repeated reports
of the same error object reference its original `errorId` instead of repeating
the whole cause. Recovered exceptions are recorded before domain translation.

**Calendar and rotation:** file dates and retention use the server's local IANA
zone, fixed for the process and announced as `timeZone` in `logging.initialized`.
There is currently no separate instance-zone setting; personal/browser timezones
do not apply. Every event is assigned its capture date before queuing, including
23:59:00 through 23:59:59.999. Async writes after midnight keep that assignment.
The next event opens the new date without restart; no empty daily files or
heartbeat entries are manufactured. Local calendar arithmetic and the next local
midnight handle 23/25-hour DST days without subtracting 24-hour intervals.
Changing the server zone while running is unsupported; restart after a zone change.

Files are opened for append. A restart on the same date preserves earlier
records. On open, a valid final JSON object missing LF gets its LF; only an
incomplete suffix after the last valid newline is truncated. No complete earlier
record is rewritten. One ordered asynchronous writer prevents interleaved lines.
Each drained batch and orderly shutdown perform `datasync`.

**Retention:** only a current, active system administrator in admin mode can
read or change **Settings → System → Server logging / Einstellungen → System →
Serverlogging**. Loader, action and service check authorization. The persisted
`logRetentionDays` accepts integers **0–365**, defaults to **30** when absent and
takes effect immediately after a successful configuration write. Invalid input
leaves the file and running policy unchanged; other TOML keys are preserved.
The explanatory value is explicitly labelled **Currently saved / Aktuell gespeichert**,
including after validation errors; it describes the persisted value, not an invalid
unsaved input. **0 = Unlimited / Unbegrenzt**, with no age deletion. For N > 0,
retain today and the preceding N−1 calendar dates; N=1 retains today, N=30 retains 30 dates in all.
Cleanup uses filename dates, never mtime, and runs at startup, after local midnight
and after a saved change. Shortening retention immediately makes older files
eligible for deletion. No size/emergency retention overrides this setting.

Cleanup serializes with rotation and protects open/queued dates. Only regular
files named exactly `pages-YYYY-MM-DD.jsonl` with real dates older than the cutoff
are removed. Future/invalid dates, symlinks, directories and foreign filenames
are left alone. There is no recursion or traversal of symlink targets, configuration,
databases, credentials or run artifacts. Cleanup counters and failures are logged;
failed files remain eligible for subsequent startup/day/change cleanups.

**Privacy and limits:** log metadata accepts at most 32 allowlisted primitive
fields (IDs, operation/route kinds, status, duration and counters), strings at most
256 characters. Objects, bodies, headers, SQL parameters, prompts, chat/wiki/ticket
texts, attachments and provider payloads are omitted. HTTP paths keep known static
segments and replace opaque segments with `:id`; all queries are omitted. SQL is
represented by operation plus a SHA-256-derived identifier, never its text or
bound values. Ordinary statements do not produce individual events. Outside the
successful polling exception below, every attempted statement contributes to
`databaseQueries`, `databaseTotalMs`, `databaseSlowestMs`,
`databaseSlowestStatementId` and `databaseSlowestOperation` in the enclosing HTTP
completion/disconnect, scheduled job, Pica job, agent step, connection initialization,
migration or transaction completion event. Durations are milliseconds rounded to
three decimal places; counts include failures and transaction control statements.
Counts measure DuckDB execution calls; a multi-statement migration/setup batch
counts as one call, without parsing or retaining its SQL text.
`databaseTransactionsCommitted` / `databaseTransactionsRolledBack` preserve every
transaction outcome. Successful nested transactions are included in their parent
completion instead of emitting another success event; standalone transactions and
all rollbacks retain individual events. Nested scopes also contribute once to each
parent scope; do not sum nested and parent summaries together. Statements outside
an enclosing operation contribute to one bounded `database.operations.completed` trace aggregate every
five seconds while there is work, and once at shutdown. No empty aggregate is emitted.
Errors always emit individual events. Statements taking **at least 250 ms** also
emit `database.statement.slow` warnings: this highlights a material portion of an
interactive request without flooding logs with ordinary local reads. Optional
`PAGES_SLOW_QUERY_MS` overrides the shared statement/slow-poll threshold (finite nonnegative milliseconds;
empty/unset/invalid values use 250; 0 diagnoses every statement individually).
Production loader/action starts and successful completions are likewise counted
in their HTTP completion/disconnect: `routeLoaders`, `routeActions`,
`routeHandlersCompleted`, `routeHandlersFailed`, `routeHandlerTotalMs`,
`routeHandlerSlowestMs` and the static `routeHandlerSlowest` route ID. Every failed
handler and HTTP control response remains an individual event, except successful
polling control responses described below. Handlers without
an open HTTP aggregate, including completions after disconnect, retain individual
lifecycle events. Route duration sums can overlap when handlers run concurrently.
Closed request scopes do not absorb later background work. This is deterministic
aggregation, not sampling or a severity filter. Cache operations always
emit safe trace metadata; the old `PAGES_CACHE_DEBUG` minimum no longer filters them.

**Successful polling exception:** `backend/logging/PollingLogPolicy.ts` centrally
lists exactly five read-only status routes. Only GET/HEAD requests qualify;
React Router's equivalent `.data` URLs and a trailing slash use the same policy.

| Route | Caller / purpose |
| --- | --- |
| `/account-version` | Authorization refresh every 5 seconds per browser tab and on focus |
| `/health` | Reverse-proxy / uptime heartbeat |
| `/agent-api/resources` | ACP occupancy diagnostics every 5 seconds |
| `/agent-api/plan-runs` | Active/paused plan status every second |
| `/settings-api/agents/:connectionId/login` | Pending CLI login status every 2 seconds |

For these routes, HTTP 2xx/3xx (including 304) below **250 ms** produce no
`http.request.started/completed`, successful `route.loader.*`/control-response
events or database/handler summary. Counts are still isolated and discarded at
completion, so they cannot leak into the five-second unscoped database aggregate.
This is an intentional completeness exception: polling produces noise without
operational value. It is deterministic by route, method, status and elapsed time;
there is no random sampling or severity filter. Their request ID header remains.
No start event is emitted even if a poll later fails: errors/status >=400, slow
responses (duration **at least** the shared threshold), disconnects, exceptions,
slow/failed statements and permission denials remain visible. Failed/slow poll
completions include all request database/handler totals; slow polls and 4xx use
warn, 5xx use error. The shared default 250 ms marks a material interactive delay;
`PAGES_SLOW_QUERY_MS` changes it for both statements and polls, including 0 for
diagnosis. Domain/security events are never suppressed by this policy.
Service initialization and maintenance triggered by a first cold request also
retain their own operational events, even when they inherit that poll's request ID.

An `/account-version` success additionally emits **`account.authorization.changed`**
exactly when the delivered existing fingerprint differs from that account's last
successfully delivered version. It contains only `userId` and the usual event
time/correlation facts, never either fingerprint or role contents. The first
delivery after startup is a silent baseline. One in-memory map retains at most
4096 accounts, evicting the least recently polled account; a subsequent first poll
after eviction is also a baseline. Failed/disconnected requests do not advance
the baseline. There is no persistence or synchronization between processes, and
changes that occur and revert between polls cannot be observed by this mechanism.

The route/client inventory also checked interval-driven mixed interfaces: `/pair`
binds/updates security state, `/api/v1/pairing/token` exchanges credentials,
`/chat-api` POST mixes journal/content reads and mutations, and project Discord
reads may retrieve external channel data. They retain ordinary logging. Search,
draft autosaves, full-page revalidation and ACP SSE streams also retain their
ordinary operational boundaries; they are not pure status/heartbeat routes.

Central redaction masks registered setup capabilities, secret-valued environment
variables, credential assignments, Authorization/Bearer/Basic credentials, common
provider-token forms, private keys, URL credentials and query values. Free-form
error messages are deliberately replaced with a safe description because providers
and DuckDB can echo full user content there. Only stackframes survive the stack's
message line; up to five cause objects and 24 frames/1200 stack characters per
cause are retained. Circular/deep/hostile errors get explicit safe markers. Messages
are limited to 4000 characters, complete serialized records to 32 KiB; shortened
text has `[TRUNCATED]` and shortened metadata/records have `truncated: true`.
Exact-value matching registers at most 256 secrets of at least four characters;
environment-value matching also starts at four characters. Named secret fields are
omitted regardless of length, and credential-assignment/header patterns mask short
values too. Malformed event serialization writes a safe marker to stderr and the
daily file and increments the same administrator-visible persistent loss counter.

**Operational boundaries:** the queue holds at most 2048 entries / 8 MiB. Filesystem
writes are asynchronous and ordered; overflow records go to sanitized stderr,
increment a persistent process loss counter and keep administrator health degraded.
Disk/permission failures retain the bounded accepted queue, report a safe OS code
through stderr and retry after five seconds. Once storage works, queued dates
are drained; later events resume normal writing. If no queued event remains, the
next event probes storage. Settings shows a warning and counts for write failures
or lost records. stderr uses a synchronous last-resort write, which can block under
overload; this avoids an unbounded secondary stream buffer. No recursive logger
calls or automatic removal of younger files attempt to hide an outage. Accepted
records are also mirrored once to sanitized stderr while storage is unavailable;
after recovery their original dates are preserved when the queue reaches disk.

Exactly **one file writer per log directory** is supported. On Linux this requires
the `flock` utility from util-linux in the server's PATH and a local filesystem.
A short, shell-free `flock --exclusive --nonblock` invocation (two-second utility
timeout) locks a duplicated descriptor; the server keeps the same open file
description until shutdown.
The kernel releases ownership on descriptor closure, including SIGKILL. See the
[Linux lock semantics](https://man7.org/linux/man-pages/man2/flock.2.html) and
[Node descriptor sharing](https://nodejs.org/api/child_process.html#optionsstdio).
The private, persistent `.writer.lock` inode is never unlinked or replaced. Its
bounded JSON record contains schema version 2, PID, random instance ID, Linux boot
ID/process start ticks and an orderly-release marker. A PID alone never grants or
denies a version-2 lock: kernel ownership prevents PID-reuse and concurrent-recovery
races. An unheld stale, empty or truncated record is replaced automatically after
acquisition, with `logging.ownership.recovered` in the daily log. No manual deletion
is required. An orderly restart appends without a recovery warning.

If another live writer holds the lock, Pages **still starts** with `LOG_WRITER_BUSY`,
sanitized stderr output, the bounded retry queue and a visible system-admin warning.
It cannot append, rotate or clean the other writer's files. It retries every five
seconds and resumes after release. Missing `flock`, unsupported platforms, invalid
lock files and ownership I/O failures use the same nonfatal degraded path. No log
ownership failure is a fatal startup condition. A live legacy PID-only record is
treated conservatively as busy; a dead legacy PID is recovered. Concurrent mixed
versions and clustering/network filesystem lock guarantees remain unsupported.
Do not remove the lock file while any writer is running.

SIGINT/SIGTERM stop producers, run service cleanup and flush/close the writer,
with a 30-second shutdown deadline. Uncaught exceptions/rejections and fatal startup
errors use the same failure-exit path; before a usable configuration/module graph,
sanitized bootstrap events go to stderr and are copied into the file when possible.
SIGKILL, power loss, an unavailable stderr, failure before capture, an overflowing
queue or permanently full disk cannot guarantee every event reaches disk.

**Event coverage:** startup/configuration, migrations and service initialization;
HTTP start/end/status/duration/disconnect and SSR errors (with the successful
polling exception above); production loader/action
lifecycle aggregates and individual failures/control responses; login/logout and
permission denials and delivered account-authorization changes; committed wiki/ticket/milestone events; DuckDB statement
aggregates, slow statements, transactions and errors; cache operations; GitHub, wiki,
Discord and model-catalog jobs; provider/integration responses;
Pages-owned Agent API/MCP requests; plan/run/step, CLI/ACP session, tool, cancellation,
closeout and persistence diagnostics, including Pica jobs. Browser telemetry,
third-party internals, full CLI stdout, prompts and content chunks are intentionally
excluded. Development includes request/error and database/service instrumentation;
the production build additionally wraps every registered loader/action. Expected
ENOENT/ENOTDIR during static-file matching, optional artifact/existence probes and
directory creation or cleanup of unused upload stores, plus handled EEXIST/process-disappearance races, are ordinary
control flow and do not emit `application.exception.caught`. Unexpected I/O and
required-file errors still do. Activity,
audit and persisted session/run histories retain their separate business purposes.

## Commands

All commands are scripts in `package.json`; run them with `pnpm run <script>`.

| Script          | What it does                                                                                                                                              |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dev`           | Starts the React Router development server (Vite) with server-side rendering.                                                                             |
| `build`         | Creates the production build in `build/`.                                                                                                                 |
| `start`         | Runs the production server from `build/` through `server.mjs`. Run `build` first. Accepts `--port <number>` and `--config <path>`.                       |
| `check`         | Generates the React Router route types, type-checks with `tsc --noEmit` and runs `prettier --check`. Checks only; the generated types go to the ignored `.react-router/`. |
| `lint`          | Runs ESLint on the repository with `--max-warnings=0`: any warning fails. Fixes nothing.                                                                  |
| `format`        | Runs `prettier --write` and rewrites files in place.                                                                                                      |
| `test:backend`  | Backend unit tests with coverage (see [Unit tests](#unit-tests)).                                                                                         |
| `test:frontend` | Frontend unit tests with coverage (see [Unit tests](#unit-tests)).                                                                                        |
| `clean`         | Deletes the `build/` directory.                                                                                                                           |

There is no `test` script. CI runs `check` and `lint` on pushes to `main` and
on pull requests.

## Unit tests

Pages has two separate unit-test scopes. Each runs Vitest once with V8 coverage:

| Script          | Environment | Test files                                 | Coverage report      |
| --------------- | ----------- | ------------------------------------------ | -------------------- |
| `test:backend`  | Node        | `tests/backend/**/*.unit.test.{ts,tsx}`    | `coverage/backend/`  |
| `test:frontend` | jsdom       | `tests/frontend/**/*.unit.test.{ts,tsx}`   | `coverage/frontend/` |

- **Backend** is for services, repositories, validation and the server-side
  loaders and actions in `app/`.
- **Frontend** is for isolated components, hooks and client utilities.
- Tests in both scopes mock external boundaries such as DuckDB, the file
  system, the network and subprocesses. Smoke, end-to-end, browser, integration
  and live tests are not part of these scopes, and the tests do not import or
  start the independent `mcp/` package.
- **Coverage is a diagnostic report** per source module (statements, branches,
  functions, lines) without a required percentage. The two reports are
  independent and are not added up.

Run the complete Backend unit suite from the repository root with exactly
`pnpm run test:backend`. PAGE-32 rebuilds and validates this Node scope; its
[behavioral scope, results and coverage gaps](./tests/backend/README.md) document
what is covered. Run the complete Frontend unit suite with exactly
`pnpm run test:frontend`. PAGE-33 adds and validates isolated UI, hook and client
behavior; its [selection, results and coverage gaps](./tests/frontend/README.md)
remain independent. An empty run counts as a failure. New units are discovered
automatically only as `tests/backend/**/*.unit.test.{ts,tsx}` or
`tests/frontend/**/*.unit.test.{ts,tsx}` in their respective scope; other test
kinds and fixtures do not match just because they share a directory. There is no
general `pnpm run test` or aggregate test script. Scope rules, source includes and
aliases are in [tests/README.md](./tests/README.md).

## Pica Mobile WebSocket endpoint (PAGE-148)

Pages offers the Pica Mobile app a WebSocket endpoint on a port of its own. An
administrator sets the port under Settings > Connections > Pica Mobile; Pages
binds it first, stores it as `picaMobilePort` in `config.toml` and only then
closes the previous listener, so a port that is taken or cannot be stored leaves
the working setting in place. Without the key no extra port is opened. The
address for the app is `ws://<host>:<port>/pica-mobile`; version 1 has no TLS.
Connection setup, message format, error codes and limits are the contract for
the app and live in [docs/PicaMobileWebSocket.md](./docs/PicaMobileWebSocket.md).

## Pica Mobile (submodule)

`mobile/` is the native Pica app for Android and iOS (PAGE-99): Expo, React
Native and TypeScript. It has its own repository, manifest, lockfile,
dependencies, tests and builds, and Pages needs nothing from it. `pnpm run
check`, `lint` and `build` of Pages ignore `mobile/`, the Pages tests never
import from it, and no mobile dependency enters the Pages or MCP manifests. See
[mobile/README.md](./mobile/README.md) for the app, its builds and its
architecture.

**Set up** (after the conversion below). A clone gets the app with the
submodule; Pages works without it:

```sh
git clone --recurse-submodules <url of Pages>   # new clone
git submodule update --init mobile               # existing clone
pnpm --dir mobile install                        # its own dependencies
```

**Update** to the newest commit of the app and record it in Pages:

```sh
git submodule update --remote mobile
git add mobile
git commit -m "chore(mobile): update Pica Mobile"
```

Work on the app inside `mobile/`: it is a normal repository there. Commit and
push in `mobile/` first, then commit the new `mobile` pointer in Pages. A CI
checkout of Pages does not fetch submodules (the default of `actions/checkout`),
so Pages CI stays independent; the app's CI runs in its own repository.

**One-time conversion (open step).** The app is committed as a plain folder
`mobile/` because creating the repository needs a GitHub login that the
implementation did not have. Run once, in the Pages checkout, with the history of
the folder moving into the new repository:

```sh
# 1. The empty repository, under the owner of Pages.
gh repo create gesus90/pica-mobile --private \
  --description "Pica Mobile: native Android and iOS app for Pages"

# 2. Publish the history of mobile/ as the history of the new repository.
git subtree split --prefix=mobile --branch mobile-main
git push git@github.com:gesus90/pica-mobile.git mobile-main:main
git branch -D mobile-main

# 3. Replace the folder with the submodule.
git rm -r mobile
rm -rf mobile                # also removes the ignored node_modules/
git submodule add -b main git@github.com:gesus90/pica-mobile.git mobile
git commit -m "chore(mobile): register Pica Mobile as a submodule"

pnpm --dir mobile install
```

Use the HTTPS address instead of SSH if collaborators clone without SSH keys; a
private repository needs access for each of them.

## Repository layout

| Path           | Contents                                                                 |
| -------------- | ------------------------------------------------------------------------ |
| `app/`         | Routes, React components, client and server helpers, styles              |
| `backend/`     | Services, repositories, migrations, configuration, server runtime, auth  |
| `definition/`  | Shared types and contracts                                               |
| `language/`    | i18next setup and the German and English translations                    |
| `tests/`       | Unit-test scopes and setup                                               |
| `scripts/`     | Maintenance and proof scripts (`acp:smoke`)                              |
| `mcp/`         | Independent MCP server package with its own manifest and lockfile        |
| `mobile/`      | Independent Pica Mobile app (Expo); a submodule once converted           |
| `assets/`      | Logo, README banner and the Pica mascot (`assets/pica/`)                 |
| `server.mjs`   | Entry point of the production server                                     |

Further documentation:

- [GUIDELINES.md](./GUIDELINES.md): coding rules; `check` and `lint` enforce the
  rules a tool can check
- [AGENTS.md](./AGENTS.md): working rules for AI coding agents, including
  architecture boundaries and database migrations
- [tests/README.md](./tests/README.md): unit-test scopes and coverage
- [mcp/README.md](./mcp/README.md): the independent stdio MCP adapter, setup and
  tool reference
- [mobile/README.md](./mobile/README.md): the independent Pica Mobile app, its
  architecture and builds (see [Pica Mobile](#pica-mobile-submodule))
- [.env.example](./.env.example): optional environment variables

## Security notes

- **No secrets in the repository.** `.env` files are ignored; `.env.example`
  holds empty placeholders only. Keep `config.toml`, databases, the instance
  key, the `agents/` login folders and the `Agents/` folder outside the working
  tree, as the default `~/.pages/` does.
- **Do not experiment with production data.** The development server uses the
  `~/.pages/config.toml` of the current operating-system account, the same file
  a production instance of that account uses. Experiment under a separate
  account or `HOME`, and try migrations on copies of the database.
- **Treat the setup link as a secret.** While the setup is pending, anyone with
  the link can create the first administrator.

## License

Pages is open source under the [MIT License](./LICENSE).

React Flow (`@xyflow/react` and `@xyflow/system`) is MIT licensed. Its complete
[copyright and license notice](./assets/react-flow-LICENSE.txt) is retained
with the source. The plan editor uses the free library and hides its corner
attribution, which the MIT license permits; no Pro assets or services are
required.
