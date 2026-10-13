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
- Optional AI model connections, managed by administrators, for the text
  assistant, the chat and agents
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
- [mcp/README.md](./mcp/README.md): the independent MCP package
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
