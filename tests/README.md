# Pages unit tests

PAGE-32 builds and validates the Backend suite on the standalone Vitest
foundation introduced by PAGE-38. Run the complete Node unit scope from the
repository root with exactly:

```sh
pnpm run test:backend
```

This includes existing focused Backend regressions and the new authentication,
authorization, account administration, project, task, wiki, pairing, configuration,
request-processing and provider/parser tests. The behavioral analysis, boundary
choices, measured coverage and remaining gaps are in
[Backend scope](./backend/README.md). Empty discovery is an error.

PAGE-33 extends and validates the Frontend suite using exactly
`pnpm run test:frontend`. Its [behavioral analysis, boundaries and measured gaps](./frontend/README.md)
are separate from PAGE-32; existing focused UI regressions remain selected.
Pages CI test execution remains absent after PAGE-35; check and lint are non-test
gates. The independent MCP package retains its own CI test job after Pages check.

| Command                  | Discovery (relative to repository root) | Environment | Reports              |
| ------------------------ | --------------------------------------- | ----------- | -------------------- |
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
  Both reports measure `definition/`, `language/` and `app/lib/`, and each report
  counts only what its own tests execute. A module that both reports measure
  therefore has a test file in `tests/backend/` and one in `tests/frontend/`; the
  files are identical apart from their location (only the Testing Library cleanup
  that the Frontend setup registers is repeated inside the Backend copy). A
  Backend test that needs a DOM (`app/root.tsx`, `app/lib/wiki-highlight.ts`, the
  draft hooks) selects it per file with `// @vitest-environment jsdom`; the Backend
  config itself stays on Node.
- Only `*.unit.test.ts` and `*.unit.test.tsx` in the selected directory are
  discovered automatically: no manual registration or broad directory inclusion
  is needed for new Backend or Frontend units. A `.integration.test.ts`, `.test.ts`, `.spec.ts`
  or fixture in the same directory does not match. Keep other test kinds outside
  the unit trees and never label them `.unit.test.*` to make them discoverable.
  Setup files are not test files. Each scope guard checks representative
  selected and rejected paths against the configured glob as well as the Node
  or jsdom environment, scripts and direct test-source imports, including fixtures.

Use imports from `vitest`; test globals are disabled. Production aliases
`@/app`, `@/assets`, `@/backend`, `@/definition`, `@/language` and `@/scripts`
(the runner scripts that Pages imports as raw text) resolve to the
same source directories in both configs so existing imports and mock targets
stay consistent.
There are no test-directory aliases and no root-wide `@` alias: neither scope
aliases the other test tree or executable independent `mcp/` sources. Frontend
additionally resolves exactly `@/mcp/package.json` for static connection-version
metadata, so coverage can transform the mixed connection route. Cross-scope test
imports are not part of this structure.

Backend has no setup file because Node unit tests need no global initialization.
Frontend setup registers Testing Library cleanup after each test, including hook
rendering, and stubs what jsdom lacks (`matchMedia`, `document.fonts`,
`Element.prototype.scrollIntoView`). jsdom simulates a DOM; no browser automation provider is installed.
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

Both scripts enable V8 coverage by default. Reports list statements,
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
each run cleans only its own directory. Generated reports stay gitignored.
PAGE-32 generates and checks the Backend reports; PAGE-33 separately generates
and checks the Frontend reports. PAGE-38 originally configured the report paths.

## Browser suite

The browser and visual regression suite of PAGE-172 is outside both unit
scopes. It lives in `tests/browser/`, is run with `pnpm run browser:test`, and is
never discovered by `test:backend` or `test:frontend`: its files are
`*.spec.ts` and Vitest discovers only `*.unit.test.{ts,tsx}` in its own tree.
It drives a real Chromium against an isolated Pages instance built from
`build/` and has no coverage report. Setup, data, commands and the handling of
screenshots are in [browser/README.md](./browser/README.md).
