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
under *Settings → System*; it applies after the next restart.

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

Pages stores everything in one [DuckDB](https://duckdb.org) file, by default
`~/.pages/data/pages.duckdb`; the setup wizard chooses the path and stores it
as `databasePath` in the configuration. The schema is created and updated
automatically on start by the migrations in
`backend/database/migrations-duckdb/`; an applied migration must never be
edited, add a new one instead.

- **One server process per file.** DuckDB allows a single writing process, so
  Pages cannot run twice against the same file and the file cannot be opened
  by another tool while the server runs. Requests of several users are queued
  inside the process.
- **Backup:** stop Pages, then copy `pages.duckdb` (and a `pages.duckdb.wal`
  file if one exists) together with the `github-token.key` next to it.
- **No foreign keys.** DuckDB cannot update indexed columns of rows that other
  tables reference and has no `ON DELETE` actions, so the schema has none; the
  services check references and rows are archived rather than deleted.

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

## License

Pages is open source under the [MIT License](./LICENSE). Anyone may use,
copy, modify, and distribute it.
