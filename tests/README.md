# Pages unit-test structure (PAGE-38)

PAGE-38 configures a future unit-test foundation. The only test cases so far
are the targeted archive authorization tests of PAGE-24, workspace tests of
PAGE-26 and user-agent operation tests of PAGE-21 under
`tests/backend/backend/service/agents/`, the archive repository
boundary tests under `tests/backend/backend/database/repositories/`, and the
targeted Pica chat tests of PAGE-28 under
`tests/frontend/app/components/chat/`, each with their fixtures;
the full suites are planned for PAGE-32/PAGE-33 and are not available as usable,
validated test suites yet. Empty discovery is an error, not a passing suite. CI test execution
remains absent after PAGE-35. Check and lint are non-test gates.

| Future command           | Discovery (relative to repository root)  | Environment | Reports              |
| ------------------------ | ---------------------------------------- | ----------- | -------------------- |
| `pnpm run test:backend`  | `tests/backend/**/*.unit.test.{ts,tsx}`  | Node        | `coverage/backend/`  |
| `pnpm run test:frontend` | `tests/frontend/**/*.unit.test.{ts,tsx}` | jsdom       | `coverage/frontend/` |

These are the only Pages test scripts. There is no `test` script, aggregate,
alias or MCP forwarding command. Both use explicit standalone Vitest configs;
they do not load the application Vite config, React Router development runtime,
server entry or database initialization. The shared config provides technical
defaults only, without discovery, application plugins or startup hooks.

## Choosing a scope

Select by the behavior under test, not the source directory or extension:

- Backend: service/repository logic, validation, request processing, server-side
  loaders, actions and middleware, including exports under `app/`. Keep tests
  under `tests/backend/`, mirroring the source path where useful.
- Frontend: isolated components, hooks, DOM interaction and client utilities.
  Keep tests under `tests/frontend/`, mirroring the source path where useful.
- A mixed route such as `app/routes/login.tsx` gets separate test files for its
  loader/action behavior and its rendering behavior. No test file is discovered
  by both configs. Mock server dependencies before importing a route for UI tests;
  mock UI dependencies when a Node route test requires them.
- Shared executable contracts and utilities may have tests in either scope as
  appropriate to their behavior. Avoid duplicating the same behavioral assertions.
- Only `*.unit.test.ts` and `*.unit.test.tsx` in the selected directory are
  discovered. Setup files are not test files; do not add colocated, smoke, E2E,
  browser, integration or live suites to these directories.

Use imports from `vitest`; test globals are disabled. Production aliases
`@/app`, `@/assets`, `@/backend`, `@/definition` and `@/language` resolve to the
same source directories in both configs so existing imports and mock targets
stay consistent.
There are no test-directory aliases and no root-wide `@` alias: neither scope
aliases the other test tree or the independent `mcp/` package. Cross-scope test
imports are not part of this structure.

Backend has no setup file because Node unit tests need no global initialization.
Frontend setup registers Testing Library cleanup after each test, including hook
rendering. jsdom simulates a DOM; no browser automation provider is installed.
Mocks and environment/global stubs are restored between tests. Future tests must
also reset their own mutable mocks and fake timers when used.

## Unit boundaries

Mock external boundaries before importing or invoking code that can initialize
them: DuckDB/repositories, filesystem access, network/providers, application
service factories, timers/schedulers and subprocess adapters. Repository unit
tests use a mocked database contract, not a real database. Do not start real
services or compose database, network or subprocess chains.

Pages-owned Agent API, OAuth, pairing and wiki behavior belongs here, including
Pages modules in `backend/service/mcp/`. Do not import executable modules from
the independent top-level `mcp/` package or start its server, client, transport or
process, even through helpers. Its package version remains static metadata for
Pages connection instructions. There is no MCP setup, discovery or coverage here.

## Diagnostic coverage

Both future scripts enable V8 coverage by default. Reports list statements,
branches, functions and lines per source module. Explicit source includes also
select unimported files, so untested executable files remain visible. Pure type
contracts have no executable statements; they are included without inventing
runtime behavior. No minimum percentage, per-file quota, thresholds or replacement
gate applies. Do not hide gaps with coverage-ignore comments or blanket exclusions.

| Scope    | Source includes                                                                                                                                                                                                                          |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend  | All `backend/**/*.ts`, `app/**/*.server.{ts,tsx}`, `app/lib/**/*.{ts,tsx}`, `app/routes/**/*.{ts,tsx}`, `app/root.tsx`, `app/routes.ts`, `definition/**/*.ts`, `language/**/*.ts`                                                        |
| Frontend | All `app/components/**/*.{ts,tsx}`, `app/lib/**/*.{ts,tsx}`, `app/routes/**/*.tsx`, `app/root.tsx`, `app/routes.ts`, `definition/**/*.ts`, `language/**/*.ts`; only `app/**/*.server.{ts,tsx}` is excluded because it is covered in Node |

Backend includes server/resource `.ts` routes and mixed `.tsx` routes; frontend
includes the mixed routes for their UI exports. Shared modules and mixed routes
intentionally appear in both reports. Each report covers the entire module, so
server-only branches can remain uncovered in a frontend report and UI branches in
a backend report. Read these gaps in context; the reports are independent and
must not be summed or treated as a combined quota. No branch is removed to make a
scope's result look better. The two include sets together select all current
Pages TypeScript source under `app/`, `backend/`, `definition/` and `language/`.

Build/tooling configs, maintenance scripts, SQL/JSON/CSS/assets, generated route
types, test infrastructure and the independent MCP package are outside these
runtime unit-source includes. They are not excluded based on coverage results.

Each scope produces a readable terminal table plus the following files in its
own report directory:

- `coverage.txt`: the same per-module text table, including uncovered lines.
- `index.html`: HTML report with source and branch detail.
- `coverage-final.json`: machine-readable statement/function/branch counters.
- `coverage-summary.json`: all four metric summaries, overall and per module.

Full-coverage files remain visible. Reports are configured even on failed tests;
each future run cleans only its own directory. Generated reports stay gitignored.
These are intended output paths, not reports generated or verified by PAGE-38.
