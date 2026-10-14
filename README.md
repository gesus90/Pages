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
sits below the grid. It has **Agents**, **Tickets** and **Parameters** tabs.
Search, filter and sort the authorized agents and project tasks/subtasks, then
drag them onto the grid. Tickets can also be filtered by their current status:
open, done, or one workflow status such as To Do or Done. Buttons offer an
alternative to dragging. Move nodes by their header or edit their grid
coordinates. The panel edits instances and their inputs; agent definitions
remain in the existing Agents area.

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
When inserting an agent, its configured defaults become individual connected
parameter nodes. Earlier plans keep their values and bindings; old literal
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

**Play** validates and executes the saved revision using the Pages execution
service. Solid branches run independently, with at most two concurrent nodes
across the service. A join waits for every incoming predecessor to succeed; a
failed predecessor blocks its continuation. Independent CLI branches may not
write to the same working copy.

The connection of an agent decides its runner: a Codex CLI or Claude Code
connection runs the node as an Agent Client Protocol (ACP) session through the
adapter of its CLI (`codex-acp` or `claude-agent-acp`, installed for the server
account next to the CLI, whose sign-in it reuses; see
[ACP adapters](#acp-adapters-for-the-cli-runners)); an OpenCode connection
starts a real CLI session in the node's workspace; an API connection stays a
request without tools. Before a node starts, Pages reads
the agent's `AGENT.md`, binds every parameter (a placeholder is never sent
unresolved) and fixes the node's **todo list** (task list items of the node
instruction and of the bound tickets' descriptions) and **acceptance criteria**
(the acceptance criteria of the bound tickets). Both are stored with the run and
appended to the prompt together with the required closing report. The exact
model, reasoning effort and the agent's run options (workspace access, shell,
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

An OpenCode node bound to tickets reaches Pages through the local Pages MCP
process with a credential of its own: it acts with the executor's current
rights, only for the bound tickets, and only reads them and sets their
checklist entries. A Codex CLI or Claude Code node always gets the Pages MCP
process: in Read only with every reading operation, in YOLO with every
operation of the executor, both under the executor's current rights. The
credential travels in the process environment or the session request, never in
arguments, prompts or the interface, and is revoked when the node closes.

A node succeeds only when its closing report marks every todo done, proves
every criterion and every ticket entry among them is checked in the ticket, and
the session closed without leftover processes. A Read only session cannot
change tickets; there the report decides and Pages records the acceptance. The
run view shows per node the runner, one-shot call or interactive session,
session and process identity, times, the real process exit, the closeout, the
requested and effective configuration (for the ACP runners also adapter,
session mode, model as the adapter reports it, isolation and the effective
permissions), the
contract with its verdict and a link to the sent prompt. The
normalized **Pages result** is `0` for an accepted and closed node and `-1` for
any other outcome; a `-1` node fails and blocks its successors. Exit code 0
alone never counts as success.

Run and node status show waiting, running, succeeded, failed, paused or
cancelled. **Pause** persists the current run and prevents additional nodes
from starting; nodes already running may finish and close normally. **Resume**
continues that same snapshot without repeating completed nodes. Paused runs
retain their working-copy reservations. **Stop** cancels a run and ends the
running sessions with their whole process group. Reloading the page retains its
persisted state. After a server interruption, unfinished runs are marked failed
rather than silently replaying work; processes and MCP credentials the
interrupted sessions left behind are ended at startup. A new run is an explicit
action.

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
`backend/database/migrations-duckdb/` that the file has not seen yet. A schema
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
| `db:transfer`   | One-time copy of a database from the earlier SQLite version into a new DuckDB file: `pnpm db:transfer --source <pages.db> --target <pages.duckdb>`. Stop Pages first and work on a copy of the source. |

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

The scripts and their configurations exist, but the repository contains no test
files yet. An empty run counts as a failure, so neither script is a verified,
passing suite at this point. Scope rules, source includes and aliases are in
[tests/README.md](./tests/README.md).

## Repository layout

| Path           | Contents                                                                 |
| -------------- | ------------------------------------------------------------------------ |
| `app/`         | Routes, React components, client and server helpers, styles              |
| `backend/`     | Services, repositories, migrations, configuration, server runtime, auth  |
| `definition/`  | Shared types and contracts                                               |
| `language/`    | i18next setup and the German and English translations                    |
| `tests/`       | Unit-test scopes and setup                                               |
| `scripts/`     | Maintenance scripts (`db:transfer`)                                      |
| `mcp/`         | Independent MCP server package with its own manifest and lockfile        |
| `assets/`      | Logo and README banner                                                   |
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
  account or `HOME`, and try transfers or migrations on copies of the database.
- **Treat the setup link as a secret.** While the setup is pending, anyone with
  the link can create the first administrator.

## License

Pages is open source under the [MIT License](./LICENSE).
