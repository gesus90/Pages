<div align="center">

<img src="./assets/icon.png" alt="Pages" width="96" />

# Pages

**A self-hosted project management and wiki platform.**

![Status](https://img.shields.io/badge/status-early%20development-F97316?style=flat-square)
![TypeScript](https://img.shields.io/badge/TypeScript-24292F?style=flat-square&logo=typescript&logoColor=3178C6)
![React 19](https://img.shields.io/badge/React%2019-24292F?style=flat-square&logo=react&logoColor=61DAFB)

</div>

## About

Pages is an open-source, self-hosted workspace for planning projects, tracking tasks, and documenting knowledge.

It is designed to start simple and scale from personal use to small teams with role-based access.

> **Status:** Pages is currently in early development.

## Goals

- Project planning and tracking
- Task management
- Project wikis and documentation
- Multi-user support with roles and permissions
- German and English localization
- Responsive desktop, tablet, and mobile UI
- Simple self-hosting

## Tech Stack

| | Technology |
| --- | --- |
| Frontend | React 19 + TypeScript |
| Server | React Router SSR + Node.js |
| Tooling | Vite + React Router Framework Mode |
| Routing | React Router Loader, Actions, Middleware |
| UI | Tailwind CSS 4 + shadcn/ui (Radix UI) + Lucide |
| Database | DuckDB |
| Localization | i18next |
| Tests | Vitest |

## Architecture

Pages follows a small layered structure:

```text
Request
  ↓
Route / Loader
  ↓
Service
  ↓
Repository
  ↓
DuckDB
```

React Router renders Pages server-side and hydrates it in the browser. Route
middleware verifies persisted, HttpOnly sessions before protected loaders and
actions run.

## Projects and department access

Projects can belong to several departments. Department-bound roles need a
shared own department to read them; unbound roles can read all projects.
Projects without departments are visible to every active account. Project
membership alone does not extend a bound role's access.

Creating and managing projects uses the assigned management departments or an
explicit global project scope. Changing all department assignments and archiving
require responsibility for the whole project; archiving also needs its separate
permission. Only active administrator mode can permanently delete a project.
The overview supports department/status filters, search, an archive, and reusable
project templates. A project needs at least one department when the catalog is
not empty; a fresh instance can create projects before departments exist.

Within accessible projects, tickets are visible in the account's own departments
or without a department. This restriction also applies to unbound roles and
global project managers; active administrator mode can read all tickets.

## Archiving tickets and milestones

Archiving is a lifecycle step of its own, not a workflow status. An archived
ticket or milestone is not deleted: it keeps its data and its status, leaves the
active views and, for a ticket, can be restored.

- **Who may archive.** Administrators in active administrator mode, and
  accounts whose role has the capability *Milestones* and who are responsible
  for the project of the ticket or milestone. Responsibility is the one that
  milestone planning needs: project lead, or the capability *Create and manage
  projects* together with an assigned management department of the project or
  the global project scope. Ordinary write, assignment or membership rights do
  not suffice, and neither does the capability without that responsibility. A
  ticket must also be visible to the account together with all its
  descendants. The server decides again on every request, so a hidden control
  grants nothing; the MCP operations `delete_ticket` and `delete_milestone` use
  the same decision. Restoring a ticket keeps the write rule.
- **Tickets.** Archiving takes the active descendants along on all levels; for
  initiatives and epics the dialog can instead keep the direct children without
  a parent. The confirmation names the ticket, the effect and how many
  descendants per level it reaches. The workflow status is not rewritten.
- **Milestones.** Archiving removes the dependency links of the milestone and
  does not archive the tickets assigned to it. The milestone status (open,
  completed, archived) is independent of the archive.
- **Kanban.** Archived tickets are hidden by default. The archive filter of the
  tasks page is offered only to those who may archive and lists archived tickets
  only of the projects in which they may.

## Appearance

Every account chooses how Pages looks under *Settings → Personal → Appearance*:
**Light**, **Dark** or **System**. The choice applies at once to the whole
interface and is stored with the account, so it returns after the next sign-in
and on other devices.

- **System** is the default for new accounts and for pages without a session,
  such as the sign-in page. It follows the operating system preference
  (`prefers-color-scheme`) and changes with it while Pages is open. An explicit
  choice always wins over the system. An error page that the server renders
  without loader data (a 404 on a direct request) cannot know the account and
  uses the system, like the language; in the browser an error page keeps the
  theme the document had.
- **No flash, no script.** The server writes the theme to the document root
  (`data-theme`) and the stylesheet selects the palette from it, so the first
  paint already uses the right one and the client hydrates the same value. The
  browser chrome (`theme-color`) and native controls (`color-scheme`) follow
  the same choice.
- **One token scale.** Both palettes define the same semantic color tokens in
  `app/styles/tailwind.css`. Components name roles (`bg-surface`,
  `text-muted-foreground`, `bg-notice-subtle`), never a palette value, and a new
  color is a token with a value for both themes; a test lists the few files that
  may name a color directly. Colors users choose (labels, milestones, project
  and avatar colors) and third-party brand colors are not inverted. Text in a
  user color is only lightened in the dark theme where it would not be readable.
- **Contrast.** Every token pair of the dark palette meets WCAG 2.1 AA (4.5:1 for
  text, 3:1 for graphics and the focus ring). The light palette is unchanged;
  its pairs below AA predate the dark theme and are listed in
  `tests/frontend/page-29-theme-styles.test.ts`.
- **Persistence.** The theme is the `theme` column of `user_settings`
  (migration `040_user_theme.sql`); an empty or unknown value means `system`,
  so accounts that exist before the update start in System as well.

## Development

Pages needs Node.js 22.22 or newer and pnpm 10 or newer. Install dependencies
and start the local development server:

```sh
pnpm install
pnpm run dev
```

Pages is then available at <http://localhost:5173>.

Use `pnpm run build` to create a production build and `pnpm run start` to serve
it. Use `pnpm test` to verify the unit test suite, always with coverage.
`pnpm run test:frontend` and `pnpm run test:backend` verify a single scope
through the `VITEST_FRONTEND` and `VITEST_BACKEND` environment flags, also
with coverage. Suites below `tests/frontend/` verify everything below
`app/`, suites below `tests/backend/` verify `backend/`, `definition/`,
and `language/`. Each scope is held at 100% coverage on its own files, so
a run fails individually as well as together. New files below `tests/` and
new source directories are picked up automatically.
The remaining maintenance commands are `pnpm run check`, `pnpm run lint`
(which allows no warnings), `pnpm run format`, and `pnpm run clean`.

Coding conventions are defined in [`GUIDELINES.md`](./GUIDELINES.md).

## First start and configuration

Pages keeps its settings in `~/.pages/config.toml` (TOML). The file is
created on the first start; values added by hand are kept when Pages
rewrites it. Start parameters win over the file, the file wins over the
defaults:

```sh
pnpm start --port 8080                     # port, stored in the configuration
pnpm start --config /srv/pages/config.toml # another configuration file
```

The default port is 3000. If the port is taken, Pages names it and stops
instead of moving to another one. Administrators can change the stored port
under *Settings → System*; it applies after the next restart. A port given
with `--port` replaces the stored one for good.

*Settings → System* is open to administrators in the admin mode. Besides the
port it holds the company name and logo (JPEG, PNG, WebP, or SVG up to 2 MB;
SVG files with scripts or outside references are rejected), which Pages shows
in the navigation and on the sign-in page, and a read-only status with the
version, the database file, and the start time. The sign-in page and the logo
are reachable without a session, so restrict who may open Pages with your
firewall or reverse proxy.

Reverse proxies and uptime monitors can poll `/health` without signing in. It
answers `200` with `{"status":"ok"}` while the database responds,
`{"status":"setup"}` while the setup is pending, and `503` with
`{"status":"unavailable"}` when the database fails or takes longer than three
seconds. It names neither a version nor a path.

While `firstRun = true`, every page leads to the setup wizard. Pages prints a
one-time setup link with a token to the server console, for example
`http://localhost:3000/setup?token=…`; without the link the wizard asks for
the token. The wizard asks for the company name, the main administrator, and
the database file, then signs the administrator in. Only then does Pages
create the database and set `firstRun = false`. A cancelled setup leaves
nothing behind and starts over on the next visit. The development server
(`pnpm dev`) prints the link with its own port.

To run the setup again, stop Pages, set `firstRun = true`, and start it.
Existing data stays: choosing the existing database keeps all projects,
tasks, and accounts, the company name is replaced, and an administrator
with the entered username is updated (another account with that name is
never turned into an administrator).

## Data

Pages stores its data in one [DuckDB](https://duckdb.org) file, by default
`~/.pages/data/pages.duckdb`; the setup wizard chooses the path and stores it
as `databasePath` in the configuration. Files attached to wiki pages and to
tickets are not kept in the database but in the `wiki-attachments` and
`ticket-attachments` folders next to it. The schema is created and updated
automatically on start by the migrations in
`backend/database/migrations-duckdb/`; an applied migration must never be
edited, add a new one instead.

- **One server process per file.** DuckDB allows a single writing process, so
  Pages cannot run twice against the same file and the file cannot be opened
  by another tool while the server runs. Requests of several users are queued
  inside the process.
- **Backup:** stop Pages, then copy `pages.duckdb` (and a `pages.duckdb.wal`
  file if one exists) together with the `github-token.key` and the
  `wiki-attachments`, `ticket-attachments` and `agents` folders next to it,
  plus `config.toml`.
  If `PAGES_GITHUB_TOKEN_KEY` supplies the instance key, preserve that value
  separately in the secure backup instead of a key file. The key protects
  both GitHub tokens and saved agent API keys. The `agents` folder contains
  sensitive CLI account credentials: restrict backup access and retain its
  directory/file permissions (0700/0600) when restoring as the service user.
- **No foreign keys.** DuckDB cannot update indexed columns of rows that other
  tables reference and has no `ON DELETE` actions, so the schema has none; the
  services check references. Project archiving retains its data; permanent
  project deletion cleans up its related records in one transaction.

### Moving from the SQLite version

Earlier versions kept their data in `pages.db` (SQLite). Pages does not read it
anymore. To carry the data over once:

1. Stop Pages and copy `pages.db` (plus `pages.db-wal` and `pages.db-shm` if
   present) to a temporary folder. Work on that copy.
2. Make sure no `pages.duckdb` exists at the new location.
3. Run `pnpm db:transfer --source <copy>/pages.db --target <path>/pages.duckdb`.
4. Start Pages. Without a configuration file it adopts a transferred database
   at the default path that has an administrator; otherwise choose the file
   in the setup wizard, which keeps its data.

The source is opened read-only, the copy runs in one transaction, and every
table's row count is compared. Running the command again changes nothing.

## Agent connections

*Settings → Agents* manages named, instance-wide connections; each has a usage
scope (see *Usage scope of connections*). Like *System*,
it is listed only for personal administrators in active administrator mode;
switching modes shows or hides both entries immediately. Opened directly in
role mode, the page only offers the switch, and connection metadata and
actions require active administrator mode. Up to 50 connections can coexist, including
multiple connections to the same provider. Names are unique regardless of
case, and the provider cannot be changed after creation.

- **API keys:** OpenRouter, OpenAI, Google AI Studio, Z.AI (international
  standard endpoint), and Anthropic. Keys are encrypted with AES-256-GCM
  using a separate HKDF-derived instance key. Saved keys and key fragments
  are never sent back to the browser. Leaving the replacement field blank
  retains the key; replacing it clears both check results. Legacy diagnostic
  model settings remain stored; model and level choices belong to Agent tasks.
- **CLI accounts:** install the official Codex CLI or Claude Code on the
  server following the provider's installation instructions. The Pages
  service must find `codex` or `claude` in its own PATH (or next to its Node
  executable); an interactive shell's PATH may differ. Restart the service
  after changing its environment. Pages shows the discovered binary paths.
  Phase 1 implements the documented CLI contracts; installed versions and
  real account flows still require separately authorized verification.

CLI accounts use the official login commands, with a dedicated
`agents/<connection-id>/` directory next to the database, isolated HOME,
configuration, and working directories, and a restricted environment.
Existing personal CLI credentials are not imported or modified. Codex uses
ChatGPT device-code sign-in, which must be enabled in the account's security
settings. Claude Code uses Claude account sign-in and forwards the entered
authorization code to that CLI's stdin. Each panel also offers an isolated
terminal command to run as the Pages service's operating-system user.
These directories isolate configuration and credentials, not the service
user's operating-system privileges.

Opening the page starts no CLI process or provider request. A successful
access check or CLI sign-in also loads the model list (see *A7 models and
reasoning*). Checks require an explicit action and keep
separate timestamped results:

- **Access check:** free API credential/model-list validation. Z.AI uses a
  one-token minimal request to `glm-4.7-flash` with thinking disabled.
  CLI sign-in status is checked locally; this does not prove that a later
  server request will succeed.
- **Model/CLI test:** requires confirmation and sends only
  `Reply with exactly: OK`, with no project or wiki content. It can incur
  API charges or consume subscription quota. APIs require a saved model;
  an empty CLI model uses the tool's default. A saved reasoning effort is
  passed along. Reported CLI cost is an
  accounting estimate, not an additional subscription charge.

API checks time out after 15 seconds (access) or 30 seconds (model). CLI
checks have an overall 25/45-second deadline; login runs asynchronously and
is polled every two seconds while active. One operation per connection,
three active logins, and four CLI processes are allowed. Output is bounded,
errors are sanitized, and shutdown terminates active CLI process groups
before closing the database. In-progress login sessions are not resumed
after a Pages restart; completed credentials and check results persist.

Signing out or removing a CLI connection removes its Pages-owned credential
directory. A cleanup failure retains the connection for retry. Sessions can
also be revoked in the provider account. Pages does not yet use these
connections for text editing, chat, task routing, or other productive work.

## License

Pages is open source under the [MIT License](./LICENSE). Anyone may use,
copy, modify, and distribute it.

### Execution profiles and assignments (A10.1)

Connections can be enabled or disabled without replacing their encrypted keys or
isolated CLI logins. Each connection can have several named execution profiles,
each with a catalog-listed model, reasoning level, active state and purposes:
Text, Chat or Agent execution. Administrators assign profiles to people, groups,
departments or explicit System functions such as System → Text and System → Chat.
These assignments do not grant access to reusable agent task definitions.

The assistant offers only assigned, active profiles with verified access and a
valid model/level in that connection's own catalog. Several eligible profiles
require an explicit choice; a revoked or disabled selection fails without switching
to another account. Personal and System profiles have equal priority. Group
membership and department membership are checked again on the server for each
request. Team leaders with user-management permission can additionally use profiles
assigned to their explicitly managed departments. Administrator status and global
management scopes do not grant an execution bypass. Only active administrator mode
can manage connections, profiles and assignments.

Existing Text configuration becomes a System profile for Text and Chat, preserving
the previous editor behavior. The original Text assignment API remains a synchronized
compatibility facade. The profile editor can separate its Text and Chat assignments.
No quotas or new consumption display are included, and configuring Agent execution
profiles does not introduce a new runner, workspace or execution plan.

### Usage scope of connections (PAGE-19)

API and CLI connections are system resources, not personal copies. Each
connection has a **usage scope** that decides which Pages accounts may use the
models offered through it. Administrators set it in *Settings → Agents* (active
admin mode), in the connection panel under *Use of the models*:

- **Global:** every active account.
- **Restricted:** the selected people and the current members of the selected
  groups and departments. The targets form a union; one match is enough.
  Group and department membership is read at every check, so a change applies
  to the next check. Managing a department does not make a person a member.

The scope is an additional limit on top of the profile assignments above: a
person needs an assignment of the profile and a scope that admits them.
Administrators get no usage bypass; managing a connection is not using it.
Connection access checks and model tests stay available to administrators.

The server checks the scope for API and CLI connections alike, when models are
offered (text and chat profiles, reusable agents, personal access) and again
immediately before every model call, including each call of a longer chat
answer or plan step. A person outside the scope is not offered the models of
the connection and cannot run them by a forged or stale selection: the call is
refused with `accessDenied` and the provider is not contacted. A reusable agent
for personal access keeps naming the model it requires; running it needs the
person's own access, and the connection of that access has to admit them too.
Keys and account details stay on the server and never appear in lists,
responses or errors.

Existing connections become **Global** with the migration, and new connections
start Global, so nobody gains or loses access silently. A group or department
that a connection scope lists cannot be deleted until the scope is changed.
Deactivated accounts lose access whatever the scope says. Only administrators
in active admin mode can create connections or change their scope; because
membership is read live, whoever may change group or department memberships
also changes who passes a restricted scope.

### Local workspaces (A10.3, PAGE-25)

Under **Agents → Workspace** (`/agents/workspaces`; *Arbeitsverzeichnis* in the
German interface) people register an existing local directory as a workspace of
a project. A workspace has exactly three properties: a **name**, a **local path**
and a **project**. Registration and removal change database metadata only;
directory contents, Git branches, local changes and the project's GitHub link
remain intact.

- **Only projects with a GitHub link** can have a workspace, which is the stored
  repository address of the project's GitHub integration. The server refuses any
  other project on every save, and the form lists such projects as not
  selectable. The workspace always reads the project's current repository link;
  no GitHub secrets are copied and no clone, push or branch switch is triggered.
  If the project later loses its link, the workspace stays in the list, is
  marked unusable and cannot be chosen or run until the link exists again.
- **Visibility follows the project.** Everyone who can open the project sees its
  workspaces and can choose them in the execution plan. There are no extra
  grants for people, groups or departments; a person without access to the
  project learns nothing about its workspaces, also not through direct requests,
  which answer exactly like a request for a workspace that does not exist.
- **Management** belongs to Pages administrators in active admin mode and to the
  managers of the project: the same responsibility that edits its general
  information and GitHub link (a member with the project role *Manager*, or the
  project right together with a scope over the project's departments or all
  projects). Moving a workspace to another project needs that right on both
  projects. Everyone else gets no registration, edit or removal action, and the
  server rechecks the right on every request.
- **Removal is confirmed** in a dialog that states that the directory, its files
  and the project's GitHub link stay unchanged. A workspace that an agent
  default, a plan or an active execution still refers to cannot be removed;
  administrators see what refers to it, managers only the kinds of references.
- **Paths are local.** A path is an absolute directory on the Pages server.
  URLs, `host:path` notation and network share notation (`//host/share`) are
  refused.

Set `PAGES_WORKSPACE_ROOTS` to approved existing absolute directory roots, separated
by the operating system's path delimiter (`:` on Linux). An empty setting disables
registration and resolution. Pages canonicalizes paths and symlinks, requires its
service user to have read/write/traversal access, excludes instance data and
rejects overlapping registrations. Resolution checks the saved directory identity
again and fails explicitly after replacement or lost permissions. The allowlist
and separate directory registrations do not provide an execution sandbox.

Migration `041` removes the usage grants that A10.3 stored per workspace (the
table `agent_workspace_targets`). Existing registrations stay and are now
visible to everyone who can open their project, so a workspace that was limited
to some people is no longer limited; one whose project has no GitHub link is
listed as unusable until the project gets a link or a manager assigns another
project. To see which registrations carry grants, run this on a copy of the
database before upgrading:

```sql
SELECT workspace_id, kind, count(*) AS grants
FROM agent_workspace_targets
GROUP BY workspace_id, kind;
```

Agent parameters can select registered workspace IDs as defaults. Server preparation
reauthorizes model access, workspace references and Wiki content, deriving project
context from the selected workspace. Only the explicitly named workspace directory
parameter produces a working-directory contract for the later CLI runner. A path
mentioned in the prompt has no such effect.

### Execution plans (A10.4)

The expandable **Agents** sidebar entry below Tasks links to **Execution plan**,
**Workspace** and the **Agents list** (see *Agents of users*). At `/agents/plans`, people with
access to a workspace's project can create named private plans or share usage with
everyone who has that access. The plan offers only workspaces of accessible
projects; one that is unavailable (path changed, project without GitHub link) is
listed as unavailable and cannot be chosen. Only the owner edits a plan. Project
and GitHub context always come from the workspace; changing a plan's workspace
requires removing its nodes first.

The grid accepts agent, task/subtask and global text variable nodes by drag-and-drop
or Insert buttons. Flow ports define successful predecessors and joins; parameter
ports explicitly bind tasks, variables or successful predecessor results to text
parameters. Workspace and Wiki parameters retain their existing typed reference
checks. Inputs, templates and referenced text are frozen when Play starts a saved
revision. Plan edits affect future runs; access is resolved again immediately before
each actual step starts, using the executing user's own applicable access.

Preflight rejects cycles, unavailable definitions/models/directories and unordered
CLI writes to the same working copy. Writing copies are reserved transactionally
throughout each run, including across plans and users. CLI steps require an explicit
directory parameter: their process cwd is the registered copy while credentials
remain in an isolated home. API steps use the existing text adapter. At most two
steps run concurrently per instance service. No Git operations are performed by
the plan service; a branch parameter is literal input.

Run views show waiting, running, succeeded, failed and cancelled steps, sanitized
final text and stable error codes. Failed predecessors block dependents while
independent branches may finish. Stop prevents future starts and requests active
abort; confirmed cancellation appears only after adapter/process completion. Run
history is private to the executor and requires current resource access. The UI
shows the last twenty own runs. Retry, resume and conditions are not implemented.
After an interrupted server process, unfinished runs are marked failed and unknown
writing reservations remain held for operator review; there is no automatic resume
or automatic release of potentially active processes.

Full tests, coverage, final build and overall acceptance remain deferred to A10.5.

### Agents of users (PAGE-20)

**Agents → Agents list** (`/agents/agents`; *Agents Liste* in the German
interface) is where people create and manage their own agents for recurring
work such as tests and tasks. The list shows the agents of users: the person's
own and those shared with them. Administrators keep managing connections, model
profiles and their agents under *Settings → Agents*, which the page links to for
them; they do not edit or delete the agents of users.

- **Model and reasoning.** An agent names one *model profile* with the purpose
  Agent that administrators set up, and a reasoning level that the model's
  catalog lists (the level of the profile is only the preselection). The form
  offers only profiles that are released for the person, whose connection scope
  admits them and that are not bound to a project, because an agent of a user
  has no project. An agent stores no API key, CLI login or connection of its
  own. The server checks the same facts again for the
  person who **starts** a run: model release, connection scope, an active
  account and the sharing of the agent. Sharing an agent therefore never extends
  a model grant; someone without access to its model cannot run it, and a
  direct request does not bypass that. If an administrator changes or withdraws
  the model profile, the agent is listed as unavailable until its owner chooses
  a model again.
- **Content.** Name, instruction (the template with its placeholders) and the
  typed parameters use the same editor as the agents of administrators and are
  saved with the agent, including workspace and wiki references.
- **Sharing.** A new agent is **private**: only its owner sees and runs it.
  **Global** lets every active account see and run it. **Restricted** names
  groups and/or departments and combines them with **OR** (membership in at
  least one) or **AND** (membership in every one). Membership is read again on
  each check, so a change applies from the next request. A deleted group or
  department matches nobody, which keeps an AND share closed; the owner's view
  leaves such targets out, says so, and the next save stores the cleaned list. The right
  to manage a department does not make someone a member for this purpose. Only
  the owner changes an agent; others with access can open it read-only.
- **Definition file.** For every agent that plans can run, Pages writes
  `Agents/<agent-id>/AGENT.md` in the folder *next to `config.toml`* (by default
  `~/.pages/Agents`), apart from the data directory. It holds a heading, the
  agent identifier and the stored definition (name, model, reasoning level,
  revision, instruction, parameters and sharing) as one JSON block; connection
  and credentials are not part of it and credential-shaped text is masked. Only
  Pages writes the file, from the stored definition, atomically and read-only
  (`0400`). It is written again at every start and after every save, and checked
  against the stored definition whenever a plan run that held the agent ends,
  so a lost or changed file does not outlive the run. A file that cannot be
  written is reported in the log and does not undo the save; the next save or
  start repairs it. While a plan run holds an agent, every save and deletion of
  that agent is refused with *part of a running plan*; otherwise only the
  owner's save in the form changes it.
- **Run records.** When a step of a plan has run and ended, Pages writes exactly
  one file `Agents/<agent-id>/runs/<run-id>.md` for the agent it ran: metadata
  as JSON (agent, run and plan-run identifier, executor, start and end time,
  status `succeeded`, `failed`, `cancelled` or `timeout`, model, reasoning
  level), the prepared input as sent to the model and the result or the error
  code, with credential-shaped text masked. The run identifier is derived from
  the plan run and the step, so repeated completion or recovery writes the same
  file and never a second one. A step that never reached its turn (blocked by a failed
  predecessor, or stopped before its start) has no record; a step whose start
  was refused, for example because access was withdrawn, is recorded as failed.
  Runs that ended before migration `042` get none. The record is stored in the
  database first; a lost file is written again at start and when the record is
  read, which delivers it even then. A file problem never disturbs the plan run.
- **Access.** The files are not served by the web server. The route
  `/agent-api/run-records/<agent-id>/<run-id>` returns a record as Markdown only
  to the person who started the run, while the agent is still visible to them
  and the plan, its workspace, tickets and wiki pages are still accessible; it
  answers alike for a record of someone else and for one that does not exist,
  is never cached and is sent with `nosniff`.
- **DREAMING.** The files are laid out per agent and run so that a later
  analysis finds them. No automatic evaluation exists yet.
- **Protection while agents run.** A working copy may neither contain nor lie
  within the data directory or the `Agents` folder; registration refuses it. If
  bubblewrap is installed at `/usr/bin/bwrap` and starts a namespace for the
  service account (Pages tries once per process), the CLI processes of plan
  steps run in a mount namespace in which only the working copy and their
  credential home are writable and the instance folders appear empty. Where it
  is missing or refused, they run as before and Pages logs a warning once; the
  protection then rests on the sandbox of the CLI itself, the separation above,
  the read-only file and the repair after each run. A process under the account
  of the service can still *read* every file of that account, including the
  database and the run records, when no namespace is in place. Set
  `PAGES_CLI_ISOLATION=required` to refuse CLI plan steps instead of running
  them without isolation. Agent identifiers are accepted only as
  `[A-Za-z0-9-]{1,100}`, so no identifier can address another path.
- **Limits and administration.** One person can create at most 100 agents.
  Administrator lists, reports and deletion checks (connections, groups,
  departments, ticket assignments) leave the agents of users out: an
  administrator can neither change them nor learn their names there.

Migration `042` adds the columns `owner_id` and `model_profile_id` to
`agent_execution_profiles` (empty for administrator agents) and the tables
`page_agent_run_inputs`, `page_agent_run_records` and `page_agent_archived_runs`.
They exist only in DuckDB; `pnpm db:transfer` leaves them untouched.

### A7 models and reasoning

Agent tasks assign a function to a named connection, a model from that connection's
loaded catalog, and one of that model's listed reasoning levels. The connection
dropdown names each connection with its provider, such as "Account1 (OpenAI API)" or
"TSK_100 (Z.AI API)". The connection and model dropdowns open a panel that starts
with a search field; every typed word must match, ignoring case, a connection's name
or provider, or a model's ID or display name. The model panel adds prefilters for
models with reasoning levels and, when the catalog carries prices, for free models,
plus a live result count. Arrow keys and Enter choose inside the panel; Escape closes
only the panel. Every model option includes its ID. Searching and prefilters preserve
configuration; changing the connection or model clears dependent choices. Missing or
invalid assignments remain visible and fail explicitly, without another connection,
model, or level taking their place. A model without catalog levels shows
"No reasoning level available".

Reasoning levels come from the catalogs: OpenRouter’s `reasoning.supported_efforts`
(a `null` list stands for every documented gateway effort, a model that only takes a
reasoning token budget gets the efforts OpenRouter documents to convert into that
budget, and mandatory reasoning never offers `none`), Anthropic’s
`capabilities.effort` in the documented order from `low` to `max`, Codex’s
`supported_reasoning_levels` and Claude Code’s `supportedEffortLevels`. Google’s
listing reports only a `thinking` flag; a thinking model whose exact ID appears in
Google’s documented thinking-level table gets that table’s levels, which are sent as
`thinkingConfig.thinkingLevel`. OpenAI’s listing carries no reasoning data, so its
models offer no level. Explicit `reasoning.supported_efforts` metadata is kept when
a listing provides it.

Connection panels register access and manage catalogs, without model or level
selectors. Existing diagnostic settings remain stored. For diagnostic checks only,
a successful access check or sign-in can initialize a previously empty test model:
the first listed Codex, Claude Code, or Anthropic model; OpenRouter’s free router or
first free model; Google’s listed latest Flash alias. OpenAI and Z.AI name no default.
These diagnostic defaults never populate Agent tasks. Loading a catalog only
retrieves metadata; it never runs a model test or sends Pages content. OpenRouter
models show **Free** only when both catalog prices are zero. A listing does not
guarantee support for the diagnostic text endpoint.

Each supported connection has a persisted refresh cadence: manual only (default),
every 6 hours, daily or weekly, plus an explicit refresh button. Changing cadence
sets the next due time from now; a refresh resets it from completion. The server checks
persisted due times every minute and refreshes at most one connection per tick.
Failures retain the last good catalog and show its timestamp and a sanitized error.
Key replacement clears account-specific catalog data while preserving cadence.
Catalogs, cadence and actions are restricted to active administrator mode.

OpenRouter, OpenAI, Google AI Studio and Anthropic use their official model-list APIs.
Catalogs keep only text models, judged by each listing’s own metadata: an OpenRouter
model must accept text and output only text, and a Google model must support
`generateContent`. OpenAI, Anthropic and Z.AI listings carry no modality data and are
not filtered by name. Signed-in CLI connections read `codex debug models` or Claude
Code’s SDK initialize catalog in their own isolated directory. Claude uses the
catalog’s `resolvedModel` when present and reads each entry’s `supportedEffortLevels`;
global help flags are not model capabilities. Every enabled picker row stays its own
model, including earlier versions and 1M-context variants such as
`claude-opus-5-5[1m]`; rows that resolve to the same model become one entry. The initialize request contains no user message. Older CLIs
without that catalog fail explicitly instead of returning help aliases. Z.AI has no
documented token-free catalog endpoint in the current adapter and cannot supply a
catalog assignment; existing diagnostic IDs remain stored. Requests have a 25-second total
deadline, a 32-page limit, 8 MiB per page, 16 MiB per refresh and 10,000 unique models.
An incomplete or oversized listing does not replace the previous snapshot.
