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

*Settings → Agents* manages named, instance-wide connections. Like *System*,
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
