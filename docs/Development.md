# Development and architecture

[Documentation index](README.md). Start with the
[local quickstart](../README.md#getting-started), then read the mandatory
[coding guidelines](../GUIDELINES.md) and [agent instructions](../AGENTS.md).
Make focused changes. The previous test suites and CI have been removed and are
rebuilt in separate steps. The new [backend unit-test foundation](BackendTesting.md)
provides the backend runner, measurement scope and the CI entry point. See the
[restart inventory](TestCiRemoval.md) for retained operating commands,
validation limits and external dependencies.

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

| Area      | Technology                                             |
| --------- | ------------------------------------------------------ |
| UI        | React 19, TypeScript, Tailwind CSS 4, Radix UI, Lucide |
| Framework | React Router 8 static app and API server               |
| Runtime   | Node.js; Vite 7 for development/build                  |
| Database  | PostgreSQL (`pg`); PostgreSQL 18 backup utilities      |
| Text      | i18next (German/English), Tiptap                       |
| Tooling   | pnpm, ESLint, Prettier                                 |

## Commands

All commands are scripts in `package.json`; run them with `pnpm run <script>`.

| Script         | What it does                                                                                                                                                                                                                |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dev`          | Starts the development server of the static app (Vite). It passes server requests to `dev:api`.                                                                                                                             |
| `dev:api`      | Starts the API's development server (port 5174) with the Pages runtime; `PAGES_DEV_API` tells `dev` another address.                                                                                                        |
| `build`        | Builds the static app (`ssr: false`) into `build/client` the API into `build/server`, and the independent Node runtimes into `build/local-owner` and `build/runs` with shared `build/runtime-chunks` (`scripts/build.mjs`). |
| `start`        | Runs the API from `build/` through `server.mjs`; it also serves the static app. Run `build` first. Accepts `--port <number>` and `--config <path>`.                                                                         |
| `typecheck`    | Generates all React Router route types and checks the TypeScript project with `tsc --noEmit`. Generated types go to the ignored `.react-router/`.                                                                            |
| `format:check` | Checks formatting with `prettier --check .` without rewriting files.                                                                                                                                                          |
| `check`        | Runs `typecheck`, then `format:check` if type generation and TypeScript succeed.                                                                                                                                              |
| `lint`         | Runs ESLint sequentially in bounded file blocks (`scripts/run-lint.mjs`) with `--concurrency=off` and `--max-warnings=0`: any warning fails. Fixes nothing.                                                                 |
| `test:backend` | Runs the independent backend Vitest configuration with V8 coverage, then reads the summary into complete section inventories. An empty test collection fails; behavior tests are added separately.                          |
| `format`       | Runs `prettier --write` and rewrites files in place.                                                                                                                                                                        |
| `clean`        | Deletes the `build/` directory.                                                                                                                                                                                             |

The CI workflow `.github/workflows/backend-tests.yml` runs on every push to
`main`. It installs dependencies from the frozen lockfile with Node.js 24 and
the pnpm version pinned in `package.json`, then runs `test:backend`. Test,
coverage and setup errors fail the job. The coverage table is written to the
job summary, and the complete coverage reports plus the checked-out revision
are kept as the `backend-coverage-<commit>` artifact. The workflow has no
pull-request, tag, schedule or manual trigger. `test:backend` is described in
[Backend unit-test foundation](BackendTesting.md); `check` and `lint` remain
manual static checks. `postgres:restore-check` verifies an actual backup and
`db:transfer` performs offline transfer; both are operating commands, described
in [PostgreSQL operations](PostgresMigration.md).

### Local static checks

Run `pnpm run lint` for the full discovered JavaScript and TypeScript source
population, and `pnpm run typecheck` for the TypeScript project in
`tsconfig.json`. Each generates route types for all routes first; a generation
failure stops that command. TypeScript follows imports and includes the
generated `.react-router/types`, so checking only individual files is not an
equivalent project check. The TypeScript command uses the existing 4096 MiB V8
old-space limit. ESLint reports file, line, column, rule and message; TypeScript
reports location, diagnostic code and message when available. Both return a
nonzero status on findings or tool failures. The lint runner reports incomplete
blocks separately from findings; a type generation failure means neither the
lint nor the TypeScript phase ran. Read the output to distinguish a setup or
tool failure from source findings.

`pnpm run format:check` is separate so formatting need not delay TypeScript
feedback. `pnpm run check` retains both checks in order and stops at the first
failure. A targeted ESLint or TypeScript invocation covers only its selected
scope and is not evidence that the repository-wide command passed. None of
these static checks establishes functional behavior or test coverage.

The source baseline before separating the commands was clean Git revision
`7dd43b072a2264ffe6f86cf1b81d641f2f95b6a0`, with Node.js `24.22.1`, pnpm
`11.23.0`, ESLint `10.11.0` and TypeScript `6.0.3` installed. Lint,
TypeScript and formatting were not run under the implementation assignment's
execution restriction, so there are no measured durations, exit codes or
findings for this revision and no measured speed comparison. The command
split avoids running formatting when only TypeScript feedback is requested;
it makes no claim about the runtime of the underlying project-wide checks.

### Repository configuration inventory

Reviewed source revision `5e0a033c2511c66f60b4a549e51492713091cba6` on
2026-11-16, with the configuration consolidation described below applied on
that revision. The inventory covers tracked root configuration and the Rust
package; deployment templates and scripts are covered by the separate
[repository audit](repository-reference-audit.md). A filename search cannot
prove that an external tool or developer never uses a configuration.

| Files                                                   | Consumer and decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` | pnpm resolves scripts, dependencies, install policy and locked versions. Keep all three; the workspace file also restricts install scripts and dependency age.                                                                                                                                                                                                                                                                                                                                                                                  |
| `vite.config.ts`                                        | React Router discovers it for `dev`, `dev:api` and the app and API builds. `scripts/build.mjs` selects `runtimes` for the independent Node entries. One file replaces the former separate runtime configuration; runtime mode deliberately excludes React Router plugins.                                                                                                                                                                                                                                                                       |
| `react-router.config.ts`                                | React Router selects static app or API output through `PAGES_ROUTES`. Keep: it is a separate framework contract.                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `eslint.config.js`                                      | ESLint, invoked by `scripts/run-lint.mjs`, discovers the flat config. Its former rule module is now included directly, preserving the same rules and ignores.                                                                                                                                                                                                                                                                                                                                                                                   |
| `tsconfig.json`                                         | TypeScript and ESLint project service consume the project and aliases; keep.                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `vitest.backend.config.ts`                              | Independent Node backend test runner and complete backend V8 measurement; does not load the application's Vite plugins.                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `prettier.config.mjs`, `.prettierignore`                | Prettier uses formatting options and exclusions for the `format` and `check` scripts; keep.                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `.gitignore`                                            | Git excludes generated and local files; keep. `.env.example` is an installation template, not a live credential file.                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `core/Cargo.toml`, `core/Cargo.lock`                    | Cargo builds and resolves the Rust service; keep the manifest and lock separately from pnpm.                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `opencode.json`                                         | Project-level OpenCode configuration excludes generated directories and `data` from watching and reading, and denies environment-file patterns except examples. Keep the existing rules. `backend/agents/acp/OpenCodeAcpConfiguration.ts` checks other unmanaged configuration locations; it does not establish that every OpenCode invocation uses this project file. Actual use outside the repository is unknown. Removing it could change resource use and read permissions; these rules are tool permissions, not an OS security boundary. |

The tracked Vitest configuration and pinned V8 provider now establish the
backend runner; no behavior test file was added under the implementation's
validation restrictions. See [Backend unit-test foundation](BackendTesting.md).
Historical reports mentioning removed commands are retained as historical
evidence. The ignored `build/`, `dist/`, `.react-router/`, `coverage/`,
`core/target/` and
`node_modules/` contain generated output or caches, while `data/`, `.env*`
(except the template) and logs are local; none is a tracked configuration
candidate. Do not delete them as part of this inventory.

The OpenCode configuration may be installation-specific, but removing it
without evidence of users and effective permissions would risk changing the
read policy. Retain it pending an owner decision. No broad configuration
removals are supported by the available evidence. The configuration count is
now one Vite and one ESLint file; React Router, TypeScript, Prettier, pnpm,
Cargo and OpenCode remain separate because their consumers and contracts differ.

The configuration loader was run directly for app development and production,
API development and production, and runtime build mode. It returned the
expected app/API plugins, API server entry, runtime inputs, output names and
alias. Importing the ESLint configuration returned its 12 sections and retained
ignores. This checks configuration loading, not server startup or emitted
bundles. Build, live development start, lint, typecheck and tests were not run
at the assignment owner's instruction; no live service or data was accessed.

### Sequential block linting

`pnpm run lint` (`node scripts/run-lint.mjs`) is the single standard entry point
for developers and agents. It discovers all non-ignored `.js`, `.mjs`,
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
concurrent memory from other processes. If the root `tsconfig.json`
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
| `scripts/`    | Build, dependency setup, maintenance and remote runner scripts          |
| `assets/`     | Logo, README banner and the Pica mascot (`assets/pica/`)                |
| `server.mjs`  | Entry point of the production server                                    |

Further documentation:

- [GUIDELINES.md](../GUIDELINES.md): coding rules; `check` and `lint` enforce the
  rules a tool can check
- [AGENTS.md](../AGENTS.md): working rules for AI coding agents, including
  architecture boundaries and database migrations
- [.env.example](../.env.example): optional environment variables
