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

Pages is a self-hosted web application for planning projects, tracking tickets
and keeping a wiki. Several users share one instance; roles and departments
decide what each account can see and change.

- Projects with departments, templates and an archive
- Tickets on a Kanban board and in a list, with hierarchy, milestones and attachments
- Wiki pages per project or for the whole instance, with search, attachments
  and a trash
- Optional AI model connections (API keys, or Codex CLI, Claude Code and
  OpenCode accounts), managed by administrators, for the text assistant, the
  chat and agents
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

A Codex CLI agent assigned to the chat runs over ACP instead (PAGE-68, next
section). Other ACP/coding agents (Claude Code, OpenCode) return a translated
explanation before execution; `/compact` stays an API-model function.

## Pica over Codex ACP (PAGE-68)

When the chat agent under *Settings › Agents* uses a Codex CLI connection, Pica
answers through `codex-acp` with the same native tools. There is no model choice
in the chat and no fallback to an API model; the assignment is resolved anew
for every new answer, so a change applies from the next message on.

- **Server-side jobs.** Sending stores the message and starts a job on the
  server. Closing the browser, switching tabs or a lost connection does not end
  it; only *Stop* does. The panel reads the job's journal after its last cursor,
  so returning shows the current state or the finished answer without running
  anything again.
- **Steering.** While Pica answers, sending stays possible. The message goes
  into the running turn through `_session/steering` (status *accepted*); a
  message that arrives between turns, or that the adapter no longer takes, is
  answered in a turn of its own (*follow-up*). Statuses: pending, delivered,
  accepted, follow-up, failed.
- **Selected data.** The attachments selected for a message (and for a steer)
  reach Codex as content blocks: text as an embedded resource (cut after
  30,000 characters), raster images up to 10 MiB. Every other type, a cut text
  or a too large image is listed under the message; the snapshot of each
  message is stored once and never changed.
- **Tools.** Codex reaches Pica's tools only through the MCP endpoint
  `POST /api/v1/pica-bridge`, with a random per-job token held in memory. Each
  call is bound to person, conversation and running turn and is authorized
  again; the existing limit of six actions per message and the exact
  confirmation lines apply. Codex approves nothing itself: the session stays
  in the read-only mode, Pages answers only the approval requests of MCP tool
  calls with yes, and every write still needs its confirmation line. The
  session has no shell, file, image, app or web tool, runs read-only inside
  bubblewrap (required) and gets no other MCP server. Models whose Codex
  catalog demands code mode, such as `gpt-6-luna`, call the same tools from
  Codex's `exec` tool; their names then carry the prefix `mcp__pages__`.
- **Sessions.** Each conversation keeps one Codex session, continued with
  `session/resume` while connection, model, effort and profile stay the same
  and no message arrived on another path. The process holds one lease of the
  shared ACP scheduler only while a job runs. Working directories are empty
  folders in `pica-sessions` next to the agent folders.
- **Consumption.** Context occupancy and tokens are shown only as the adapter
  reports them; codex-acp 2.2.2 reports no cost, shown as "not available".

The capability matrix of the installed adapter is in
[backend/agents/acp/CodexAcpCapabilities.md](./backend/agents/acp/CodexAcpCapabilities.md).

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
the Pica chat loads them. The text assistant, plan nodes and user agents keep
their own instructions. Their `AGENT.md` files, working directories and
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

## Agents in the Pages chat

Pica can list and read visible user agents, create them (`agents.create`, the
`create_agent` functionality), change individual fields, clone them and remove
owned definitions. Every action resolves the signed-in person's current rights:
sharing grants reading/usage only, editing and deletion require ownership, and
creating/cloning uses the person's current released models and accessible
parameter references. Pica has no separate technical account or additional
rights. Administrator model assignments remain outside this chat management.

For a title-only change Pica sends only `name`; for an instruction/`AGENT.md`
change only `instruction`. Named `parameterChanges` add, update or remove one or
several declarations while retaining unrelated parameters and unmentioned fields
of edited declarations. PAGE-55 string (`text`), numeric (`number`) and ticket
(`ticket`) values are supported, including zero and decimal numbers. These
changes may be combined in one request. A complete `parameters` replacement is
still available when explicitly requested. The final instruction's placeholders
must match the final declarations.

Pica reads the current agent before changes and sends `expectedRevision`.
Concurrent changes are refused. A clone copies the complete configuration,
parameters and run options into a new ID owned by the person, applies only the
requested overrides and leaves its source untouched. The source's current
visibility and revision, and the person's model/reference grants, are checked
again before creation. Without a requested new title, the clone retains the
source title.

Agent deletion requires the exact word **LÖSCHEN** in the current user message,
also with an English interface. Confirmation from earlier messages or from the
model's action parameters is not accepted; one confirmation permits one deletion
or administration mutation. Deletion checks ownership and revision again, and a
running definition cannot be changed or deleted. Existing run history is kept.
Pica receives the actual mutation receipts and safe error codes to explain what
succeeded or failed.

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

Direct runs and execution plans share this resolution and delivery path.
OpenAI, OpenRouter, Anthropic and Google API agents receive native image blocks
and separate complete text blocks. Codex and Claude ACP sessions receive PNG
image blocks after the adapter advertises image support; text is an embedded
resource when supported, otherwise a complete separate text block. OpenCode's
current stdin-only plan adapter and standalone text-only CLI requests do not
support file delivery and report `parameter_asset_transfer_unsupported` when
files are selected. A model/provider that rejects image input fails the run;
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

## Deleting agents in administration

Under **Settings → Agents → Agents**, administrators in admin mode can select
**Remove** directly, without a confirmation dialog or confirmation word. Saved
assignments and shares do not prevent deletion. A single transaction clears
function assignments, dependent user-agent model selections and saved plan
references before removing the selected administrator agent. Connections,
dependent agents, plans and their linked tickets remain intact.

User agents with a removed model stay visible with a missing-assignment message;
their owners can select another released model. Affected plan nodes keep their
inputs and bindings and require reassignment before execution. An explicitly
removed personal access selection never falls back to another model. Stale
editors must reload before saving. Historical run records remain unchanged;
definitions reserved by an active run retain their existing temporary lock.
The separate owner and Pica deletion rules above still apply.

## Agents execution plans

Under **Agents → Ausführplan** (`/agents/plans`), choose a saved plan or use
**+** to create one. Set its title, project, workspace and sharing. The project
selection narrows the registered workspaces and their ticket picker. Only
workspaces in accessible projects are offered; unavailable registrations are
explained and cannot be selected for new work.

The grid is the main editor and spans the page width. Drag its empty area to
pan it; the mouse wheel or the zoom buttons zoom it, and nodes and connections
keep their positions relative to each other. On desktop a collapsible panel
floats over the right edge of the grid without narrowing it; on small screens it
sits below the grid. Its tabs are **Agents / Groups / Tickets / Parameters**
(**Agents / Gruppen / Tickets / Parameter** in German).
Search, filter and sort the authorized agents and project tasks/subtasks, then
drag them onto the grid. Tickets can also be filtered by their current status:
open, done, or one workflow status such as To Do or Done. Buttons offer an
alternative to dragging. Move nodes by their header or edit their grid
coordinates. The panel edits instances and their inputs; agent definitions
remain in the existing Agents area.

The **Groups** tab creates and selects sequential subgraphs. A group needs at
least two agent instances; its inspector shows the directed sequence and lets
you reorder, remove and edit each instance independently. The group has one
outer flow input and output. Add named, typed boundary ports, connect outer
value nodes to them, and select the same port at several internal agent inputs.
Required values, incompatible types and removed port references are checked
before Play. Boundary values and referenced content are resolved once at group entry and
frozen for all of its steps; live resource access is still checked before each turn.
The inspector shows the external source beside the internal port assignments.
Renaming a boundary preserves its connections.

Groups currently support **Codex CLI over ACP** only. Every child must resolve
to the same adapter, connection, model, reasoning, workspace/directory, tools,
permissions and sandbox; inherited run defaults are resolved first. Conflicts
identify the agent and setting. OpenRouter and direct Claude Code are different
adapters, regardless of model names, and are refused for groups. Each accepted
step continues the same native Codex session with its own turn-scoped instruction.
A failure or rejected report blocks later children and the outer successor.
Internal steps must provide a valid `pages-report` proving their todos and
criteria; standalone steps keep diagnostic-only progress. A missing continuation
capability, changed native session ID or changed effective runtime fails the group.
Pause lets the current child settle, retains the native session until the
configured idle timeout, and starts no further child until resume. Stop closes an active or retained paused session.
Group and child states, the failing child, native session IDs and closeout are
available in the run view.

The practical example and its real provider evidence are in
`artifacts/PAGE-73/`. Reproduce it with
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

Select an **OUT** port, then a compatible **IN** port:

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
- A data IN accepts one source. Disconnect before rebinding. Wrong directions,
  unknown ports, incompatible types, duplicate connections and flow cycles
  are rejected. Existing predecessor-result connections remain available and
  require a flow path from the producing agent to the consuming agent.

Click a connection, or choose it in the **Connections** list below the grid, to
disconnect it alone; both of its nodes stay. The bin on a node removes the node
together with all of its connections; the Delete key removes the selected node
or connection.

An executable plan needs at least one usable agent, an explicit Start and a
reachable End. Every flow node must be reachable from a Start and lead to an
End; every required flow IN/OUT must be connected. Required agent inputs,
including a configured working directory, need connected, nonempty values.
Agents in the sidebar are editable templates. Each insertion fetches the current
template and stores an independent node copy of its instruction, model grant,
reasoning, parameters, directory binding and run options. Its configured defaults
become individual connected parameter nodes. Double-click an agent node to edit
its own AGENT.md instruction, released model and reasoning level; the dialog
identifies these changes as applying only to that node. Template edits, including
edits during an active run, never change existing nodes. Inserting the same
template again uses its current defaults. Existing saved plans receive their
independent copies once at server startup, under their normal revision checks.
Earlier plans keep their values and bindings; old literal
bindings can be converted into value nodes in the selection panel. They need
explicit Start/End nodes and connected required parameters before Play.

**Save** persists the metadata, positions, port references, connections and
values. Incomplete drafts can be saved; invalid connections cannot. Revision
checks reject conflicting writes. Navigation and tab closing warn about
unsaved changes, and run polling does not replace an edited draft.

**Delete plan** removes a plan for everyone it is shared with. Only its owner,
who may also edit it, is offered the action, and the server refuses anyone
else. A plan with a running or paused run cannot be deleted; finished runs stay
in the run records of the agents.

**Play** validates and executes the plan as the editor shows it, using the
Pages execution service. Unsaved changes of the owner are saved first, under
the same plan, as the next revision, and that revision is started; the new
revision and the run are stored together, so a refused save starts nothing and
a refused start leaves the plan unchanged and the edits in the editor. A plan
that changed elsewhere in the meantime is a conflict and is never replaced by
the older version. Every Play is a new run with its own ID and fresh node
states: results, errors and blocked nodes of earlier runs carry over neither
into the run nor into the parameters of its nodes, and earlier runs keep their
snapshot. While a run of the plan is active or paused, Play waits for it to be
stopped. Solid branches run independently. Non-ACP execution has at most two
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
[ACP adapters](#acp-adapters-for-the-cli-runners)); an OpenCode connection
starts a real CLI session in the node's workspace; an API connection stays a
request without tools. Play stores a stable snapshot of each node's effective
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
runner cannot enforce, such as read-only access with commands for OpenCode,
blocks the start. The ACP adapter must offer and confirm the stored model,
effort and mode before the prompt is sent, and an adapter that maps the model
to a choice of its own (Claude) is checked against the model it reports with
its first usage update; otherwise the node fails with its own reason, and
Pages never switches to another model, to an API connection or back to an
earlier runner. Every runner works unattended:
nothing waits for a person, and an action the options do not allow is refused
instead of asked.

A Codex CLI or Claude Code agent runs in exactly one of two permission modes,
chosen in the agent list. **Read only** reads the workspace and Pages content
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

Codex CLI and Claude Code YOLO plan nodes can use the GitHub connection stored
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
Codex shells preserve the environment Pages has already allowlisted, including
`GIT_CONFIG_KEY_*`, without loading a user shell profile.

The destination filter and `GH_REPO` default are **not a restriction of the
token itself**. A YOLO process can read its own temporary token, invoke `gh`
with another repository or use the API directly, up to the token's native
GitHub permissions. Pages does not downscope a classic or otherwise broad
token. Use a token restricted by GitHub when repository isolation is required.
The handoff exposes only the selected project's token, never credentials of
another Pages project or connection.

An OpenCode node bound to tickets reaches Pages through the local Pages MCP
process with a credential of its own: it acts with the executor's current
rights, only for the bound tickets, and only reads them and sets their
checklist entries. A Codex CLI or Claude Code node always gets the Pages MCP
process: in Read only with every reading operation, in YOLO with every
operation of the executor, both under the executor's current rights. The
credential travels in the process environment or the session request, never in
arguments, prompts or the interface, and is revoked when the node closes.

A node succeeds after a regular runner turn and a clean, confirmed session
closeout. Its closing report and business progress never gate execution:
missing, malformed or incomplete `pages-report` blocks, open or unreported
todos, unchecked ticket entries, unmet criteria, missing evidence and ticket
changes remain diagnostics. Combinations of these findings neither fail a node
nor block its intended successors, internal group steps or the overall run.
There is no business acceptance or manual confirmation. This applies to existing
and new nodes regardless of their saved `completion` mode or instruction text.
Runner failures, incomplete turns, permission denials, timeouts, failed process
exits, unavailable resources and failed cleanup remain execution failures.

After the turn, Pages rereads the authorized ticket checklists in both report
scopes and reconciles current requirements with the original report IDs. New or
edited requirements receive new IDs, so earlier evidence cannot prove different
work. A bound todo is done only when its current ticket checkbox is checked;
without a ticket entry, the optional report supplies its status. Open, missing
and unknown work remains visible, including when the report is absent. Criteria
keep the reported assessment, evidence diagnostics and current ticket checkbox.
Execution success makes no claim that all business work was completed. Agents
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
session; their process result remains pending until its shared closeout. A
process crash is never inferred to be success from a favorable progress report.

The existing `completion` field selects only the progress scope: `report`
(default) describes todos and acceptance criteria; `todos` describes the current
todo list without criteria or synthetic defaults. Neither scope blocks
execution. No setting change or migration of saved node copies is needed. In
the todo scope, the agent still moves the ticket to in-progress, ticks completed
todos live and moves it to review when all current todos are done. OpenCode
retains its existing status tool in that scope; other scopes receive no new
permissions, and Read only cannot change tickets.

Run and node status show waiting, running, succeeded, failed, paused or
cancelled. **Pause** persists the current run and prevents additional nodes
from starting; nodes already running may finish and close normally. **Resume**
continues that same snapshot without repeating completed nodes. Paused runs
retain their working-copy reservations. **Stop** cancels a run and ends the
running sessions with their whole process group. Reloading the page retains its
persisted state. After a server interruption, unfinished runs are marked failed
rather than silently replaying work; processes and MCP credentials the
interrupted sessions left behind are ended at startup. A new run is an explicit
action. Historical runs that failed only because of report or business findings
retain their stored failure and blocked successors. They are not rewritten or
restarted. Resume applies only to an active paused run and does not retry failed
nodes; an ended historical run requires an explicitly started new Play run,
which uses the current diagnostic-only completion rule.

Plans may be private, global, or shared with Pages groups and departments
using OR/AND membership. Global sharing still requires access to the plan's
project and workspace. Only the owner may edit. Every executor needs their own
current agent/model and ticket/wiki permissions; sharing never delegates
credentials. Only the executor may read, pause, resume or stop their run, and
resource access is rechecked on the server before execution and disclosure.

### Plans over MCP and in the Pica chat

MCP clients and Pica reach the same plans under the same rules: list and read
visible plans with their nodes, connections and status (`idle`, `running` or
`paused`, latest run, and whether the plan could start), create plans, change
their structure (nodes, flow connections and agent inputs) and their parameter
nodes one by one, list one's own runs of a plan newest or oldest first in pages,
select the newest, the first or a named run, and read the reports of a run, each
tied to its run and node. Only the owner changes a plan; a hidden plan answers
like a missing one, and runs stay private to the person who started them. Pica
finds a plan by name, asks back when several match, shows run dates and statuses
in plain words, and cannot start, stop or delete plans. The tools and their
errors are listed in the
[MCP reference](./mcp/README.md#agent-plans).

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
dependencies once as CI does:

```sh
pnpm --dir mcp install
```

### Native ACP resource scheduling (PAGE-81)

One instance-wide `AcpResourceScheduler` admits both Codex (`codex-acp`) and
Claude Code (`claude-agent-acp`). The existing DAG still determines which
steps are executable. ACP admission has a separate shared FIFO queue; queued
steps have no native ACP process and do not occupy the DAG's two non-ACP
execution slots. API and OpenCode work retain their existing execution path.

Optional flat keys in the instance's `config.toml` (restart applies changes):

```toml
maxConcurrentAcpSessions = 1
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

Starting, running, paused-but-existing, idle and uncertain native sessions
all occupy capacity. A DuckDB lease is committed before the first start
operation and removed only after confirmed process-tree closeout. Group
continuation uses the original lease and native process. Paused waiters keep
their FIFO position among eligible requests; pausing never frees a live lease.
Cancelling a queued node removes it without starting its adapter. Node deadlines
include waiting time.

An idle native session, including a paused group, is closed after five minutes
by default. Its run record receives the retirement reason and closing outcome.
Resume after expiry fails with `plan_context_changed`; Pages does not silently
start a replacement or replay accepted steps. A failed or unconfirmed cleanup
continues to occupy capacity, visibly, even beyond the idle timeout.

At startup Pages cleans durable leases before admitting work, including a
crash between reservation and recording the process start. Existing run recovery
marks interrupted work failed and never retries it. Interrupted sessions from
before this journal existed are adopted from active runs and retained workspace
reservations, so an upgrade also accounts for their cleanup failures. Shutdown cancels waiters,
drains runs and closes native sessions. Cleanup uses the inherited
`PAGES_RUN_INSTANCE` tag, also for helpers outside the adapter's process group;
an unreadable process scan cannot prove absence. Unresponsive process exit
returns an unconfirmed closeout after bounded waits. Cleanup failures and
uncertain journal writes fail closed; retained leases are retried during the
next normal startup. No automatic in-process cleanup retry or force-release UI
is provided.

The **ACP resources** card in Settings → Agents polls `/agent-api/resources`.
The endpoint rechecks an active personal administrator in admin mode on every
request and uses `no-store`. It shows occupied sessions, waiting reasons,
current available RAM, paused blockers and failed cleanup. It exposes no prompts,
workspace paths, credentials or native conversation identifiers.

This change uses the existing Pages runtime and DuckDB. It does not install
Mastra Core or introduce another workflow engine. The Mastra integration named
in PAGE-81's title remains deferred; the native resource scheduler is independent
of a future orchestration framework.

### ACP adapters for the CLI runners

A Codex CLI or Claude Code connection runs plan nodes through an Agent Client
Protocol adapter that is installed once for the account of the Pages server,
next to the CLI. The adapter is a normal npm package; Pages starts it as a
child process of the node, with the CLI of the connection and its isolated
sign-in, and finds it on the `PATH` of the server or next to the Node binary
that runs it.

| Runner      | Package                                  | Executable         | Pages accepts   | Verified with |
| ----------- | ---------------------------------------- | ------------------ | --------------- | ------------- |
| Codex CLI   | `@agentclientprotocol/codex-acp`         | `codex-acp`        | 2.1.1 up to 3.0 | 2.2.2         |
| Claude Code | `@agentclientprotocol/claude-agent-acp`  | `claude-agent-acp` | 0.90.x          | 0.90.0        |

```sh
# Install (or update to the verified version) as the account of the Pages server.
npm install -g @agentclientprotocol/codex-acp@2
npm install -g @agentclientprotocol/claude-agent-acp@0.90.0

codex-acp --version        # 2.2.2 at the time of writing
claude-agent-acp --version # 0.90.0
```

The adapter packages a Claude CLI binary of its own, which Pages never uses:
it always points the adapter at the `claude` CLI of the host
(`CLAUDE_CODE_EXECUTABLE`), so the sign-in, the version and the catalog the
other Pages checks use are the ones the node runs with. The adapter is only
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
(`apt install bubblewrap`) with unprivileged user namespaces for the server
account; without it a YOLO node fails with `plan_yolo_isolation_unavailable`
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
| `plan_acp_adapter_missing`, `plan_claude_acp_adapter_missing` | The adapter is not on the `PATH` of the server account. Install it as above. |
| `plan_acp_adapter_unsupported`, `plan_claude_acp_adapter_unsupported` | The run record names the installed adapter and the verified range. |
| `plan_yolo_isolation_unavailable`                        | bubblewrap is missing or user namespaces are off. Install or allow it.           |
| `plan_permission_mode_unenforceable`                     | The adapter did not offer or confirm the mode, for Claude Code for example a managed setting that disables `bypassPermissions`, or a server running as root. |
| `plan_model_unavailable`, `plan_reasoning_unsupported`   | The runner does not offer the stored model or effort. Choose another in the agent. |
| `codex_permission_mode_required`, `claude_permission_mode_required` | An agent saved with the earlier write mode needs a chosen mode.   |

### First start

On a fresh installation (`firstRun = true`), every page leads to the setup
wizard, and Pages prints a one-time link to the server console:

```text
[pages] Pages is not set up yet. Open the setup wizard with this one-time link:
[pages]   http://localhost:5173/setup?token=<one-time-token>
```

The setup wizard asks for the company name, the first administrator account and
the database file. Only when it finishes does Pages create the database and mark
the setup as done. The token lives only in the server process; a restart issues
a new one.

### Configuration

Pages keeps its settings in `~/.pages/config.toml`, which it creates on the
first start. A finished setup looks like this (synthetic values):

```toml
firstRun = false
port = 3000
databasePath = "/home/dev/.pages/data/pages.duckdb"
```

Setting `firstRun = true` opens the setup wizard again on the next start.

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

### Data and runtime directories

```text
~/.pages/
├── config.toml               configuration
├── Agents/                   agent definitions and run records
└── data/                     default database location
    ├── pages.duckdb          database
    ├── github-token.key      instance key, unless PAGES_GITHUB_TOKEN_KEY is set
    ├── wiki-attachments/     wiki attachments
    ├── ticket-attachments/   ticket attachments
    └── agents/               isolated logins of CLI model connections
```

`Agents/` sits next to `config.toml`. The key file and the three folders below
`data/` always sit next to the database file, wherever `databasePath` points.

When Pages opens the database, it applies the numbered migrations from
`backend/database/migrations/` that the file has not seen yet. A schema
change is a new migration; Pages rejects an applied migration whose content
changed. DuckDB allows one writing process per file: a second server or another
tool cannot open the database while Pages runs.

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
