# Development and architecture

[Documentation index](README.md). Start with the
[local quickstart](../README.md#getting-started), then read the mandatory
[coding guidelines](../GUIDELINES.md) and [agent instructions](../AGENTS.md).
Make focused changes and include relevant behavior tests with external
boundaries mocked. Detailed unit scopes and CI instructions live in
[tests/README.md](../tests/README.md).

- [Architecture](#architecture)
- [Tech stack](#tech-stack)
- [Commands](#commands)
- [Repository layout](#repository-layout)

## Architecture

The user interface is a static React Router app (`ssr: false` for the app).
The API build enables the framework server to execute loaders, actions and
resource routes; it contains no page components and renders no UI documents.
`scripts/build.mjs` first generates the app shell, then replaces the temporary
app server bundle with the API bundle. The browser starts from that generated shell and loads route data from the API;
page content is not rendered per request.

```text
Browser app → API route / loader / action
                        ↓
                     Service
                        ↓
                    Repository
                        ↓
             Database → PostgresExecutor → PostgreSQL
```

Routes handle requests, services business logic and authorization, repositories
SQL. React components live in `app/components/`; shared contracts in
`definition/`. The production server can serve app and API together; the
optional [ingress](../deploy/ingress/README.md) serves the app independently.
The service worker and account-scoped browser cache permit opening cached
views during API outages; they do not make writes work without the API.

Source evidence (2026-11-13): [route table](../app/routes.ts),
[React Router configuration](../react-router.config.ts),
[Vite configuration](../vite.config.ts), [build script](../scripts/build.mjs),
[database facade](../backend/database/Database.ts),
[configuration parser](../backend/config/PagesConfig.ts) and
[setup service](../backend/setup/SetupWizardService.ts).
PostgreSQL is the only runtime backend. DuckDB remains a development-only
dependency of offline transfer; see [Database executor](DatabaseExecutor.md).

The internal architecture wiki (page `6f4a24af-67bf-48a3-a89c-67f882b75647`,
revision 6, read on 2026-11-13) describes the November 4 transition and an
October technology snapshot: its DuckDB fallback and framework/SSR classification
are historical. It is access-controlled, not a public installation guide.
These source-backed repository instructions describe the checked checkout.

## Tech stack

| Area      | Technology                                                     |
| --------- | -------------------------------------------------------------- |
| UI        | React 19, TypeScript, Tailwind CSS 4, Radix UI, Lucide         |
| Framework | React Router 8 static app and API server                       |
| Runtime   | Node.js; Vite 7 for development/build                          |
| Database  | PostgreSQL (`pg`); PostgreSQL 18 used by repository test tools |
| Text      | i18next (German/English), Tiptap                               |
| Tooling   | pnpm, ESLint, Prettier, Vitest, Playwright                     |

## Commands

All commands are scripts in `package.json`; run them with `pnpm run <script>`.

| Script          | What it does                                                                                                                                                              |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dev`           | Starts the development server of the static app (Vite). It passes server requests to `dev:api`.                                                                           |
| `dev:api`       | Starts the API's development server (port 5174) with the Pages runtime; `PAGES_DEV_API` tells `dev` another address.                                                      |
| `build`         | Builds the static app (`ssr: false`) into `build/client` and the API into `build/server` (`scripts/build.mjs`).                                                           |
| `start`         | Runs the API from `build/` through `server.mjs`; it also serves the static app. Run `build` first. Accepts `--port <number>` and `--config <path>`.                       |
| `check`         | Generates the React Router route types, type-checks with `tsc --noEmit` and runs `prettier --check`. Checks only; the generated types go to the ignored `.react-router/`. |
| `lint`          | Runs ESLint sequentially in bounded file blocks (`scripts/run-lint.mjs`) with `--concurrency=off` and `--max-warnings=0`: any warning fails. Fixes nothing.               |
| `format`        | Runs `prettier --write` and rewrites files in place.                                                                                                                      |
| `test:backend`  | Backend unit tests with coverage (see [Unit tests](../tests/README.md#choosing-a-scope)).                                                                                 |
| `test:frontend` | Frontend unit tests with coverage (see [Unit tests](../tests/README.md#choosing-a-scope)).                                                                                |
| `browser:test`  | Builds, then runs the browser and visual regression suite of the ticket image viewer in a real Chromium (see [Browser tests](../tests/README.md#browser-suite)).          |
| `clean`         | Deletes the `build/` directory.                                                                                                                                           |

There is no `test` script. CI runs `check` and `lint` on pushes to `main` and
on pull requests; it runs no tests and no browser suite there. Only a pushed
`ci_test` tag runs them (see [CI test tags](../tests/README.md#ci-test-tags-page-290)).

### Sequential block linting (`PAGE-192`)

`pnpm run lint` (`node scripts/run-lint.mjs`) is the single standard entry point
for developers, CI and agents. It discovers all non-ignored `.js`, `.mjs`,
`.cjs`, `.ts`, `.mts`, `.cts` and `.tsx` files from the repository root using
the active Flat Config (`eslint.config.js`, which excludes `build/**`,
`**/coverage/**`, `.react-router/**` and `**/dist/**`), partitions
them into deterministic, disjoint blocks of the root project files (`tsconfig.json`), and checks one block process
at a time (`concurrency = 1`, `--concurrency=off`, `--max-warnings=0`, no `--fix`).
Each child process exits before the next block starts so TypeScript
`projectService` contexts do not accumulate across blocks.

| Setting                                      | Default                                      | Environment override            | CLI override                                                | Valid range                         |
| -------------------------------------------- | -------------------------------------------- | ------------------------------- | ----------------------------------------------------------- | ----------------------------------- |
| Max files per block (`blockSize`)            | `200` (`DEFAULT_BLOCK_SIZE`)                 | `PAGES_LINT_BLOCK_SIZE`         | `--block-size <int>` / `--block-size=<int>`                 | `1..5000` (positive integer)        |
| Node V8 old-space heap (`maxOldSpaceSizeMb`) | `2048` MiB (`DEFAULT_MAX_OLD_SPACE_SIZE_MB`) | `PAGES_LINT_MAX_OLD_SPACE_SIZE` | `--max-old-space-size <int>` / `--max-old-space-size=<int>` | `128..65536` MiB (positive integer) |

CLI flags take precedence over environment variables, which take precedence over
the defaults in `scripts/run-lint.mjs`. Invalid values (`0`, negative numbers,
floats, non-numeric strings or unknown flags) and empty file selections fail
immediately with exit code `2` without falling back. Normal lint findings
(exit code `1`) continue through the remaining blocks and return exit code `1`
with a summary of all failed blocks; fatal configuration errors, OOM or
`SIGINT`/`SIGTERM` forward the signal to the active child process, wait for it
to exit, stop before starting further blocks and report the checked and
remaining unchecked file counts.

**Memory characteristics and `projectService` boundaries:** `eslint.config.js`
enables `projectService: true` for typed rules. Even a small block (for example
50 files) loads the enclosing TypeScript program (`tsconfig.json`), requiring a baseline of roughly `1.15–1.20 GiB` V8 heap
(`~1.45 GiB` process RSS) per child process; at `200` files per block, measured
per-process peak usage is `~1.35–1.50 GiB` V8 heap and `~1.60–1.70 GiB` RSS.
`--max-old-space-size` bounds only V8 old-space heap, not total process RSS
(which includes V8 code/new space, C++ allocations and shared libraries) and not
concurrent memory from agents or test workers. If the root `tsconfig.json`
program grows beyond the per-process heap budget even for small block sizes,
the next structural step is splitting `tsconfig.json` into smaller TypeScript
project references rather than disabling typed rules.

## Repository layout

| Path          | Contents                                                                |
| ------------- | ----------------------------------------------------------------------- |
| `app/`        | Routes, React components, client and server helpers, styles             |
| `backend/`    | Services, repositories, migrations, configuration, server runtime, auth |
| `definition/` | Shared types and contracts                                              |
| `language/`   | i18next setup and the German and English translations                   |
| `tests/`      | Unit-test scopes and setup                                              |
| `scripts/`    | Maintenance and proof scripts (`acp:smoke`)                             |
| `assets/`     | Logo, README banner and the Pica mascot (`assets/pica/`)                |
| `server.mjs`  | Entry point of the production server                                    |

Further documentation:

- [GUIDELINES.md](../GUIDELINES.md): coding rules; `check` and `lint` enforce the
  rules a tool can check
- [AGENTS.md](../AGENTS.md): working rules for AI coding agents, including
  architecture boundaries and database migrations
- [tests/README.md](../tests/README.md): unit-test scopes and coverage
- [.env.example](../.env.example): optional environment variables
