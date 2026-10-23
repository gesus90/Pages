# Backend unit scope (PAGE-32)

Run the complete suite from the repository root with exactly:

```sh
pnpm run test:backend
```

The existing standalone `vitest.backend.config.ts` runs Vitest in Node with V8
coverage. PAGE-32 retains the runner, scripts, aliases and diagnostic source
includes of PAGE-38. There is no `test` script, combined test command, MCP
forwarder, browser environment or application startup hook. Check and lint are
separate non-test gates. Frontend is not executed by this command.

## Selection rule

A new Backend unit test is automatically included when its path matches
`tests/backend/**/*.unit.test.{ts,tsx}`. Select by the server behavior under test,
then use this path and suffix; mirroring the production source path is useful
but not required. Test helpers have no `.unit.test` suffix. A `.test.ts`,
`.spec.ts`, `.integration.test.ts`, `.e2e.test.ts`, `.browser.test.ts`,
`.smoke.test.ts` or `.live.test.ts` file does not match, even in the same
folder. Other test kinds must stay outside the unit tree and must not be
renamed as units. The glob is a filename rule, not a claim that everything in
a directory is a unit test.

The scope guard in `scope/backend-scope.unit.test.ts` verifies the configured
Node environment, exact script and positive/negative discovery examples. It
also scans direct imports throughout Backend test sources and helpers for
Frontend test-tree, independent MCP package and MCP/browser-runner imports.
This static guard supports source review; it cannot prove arbitrary transitive
or computed imports safe. Review new test boundaries as well as the filename.

Excluded: `tests/frontend/`, React rendering/hooks/DOM assertions, browser,
E2E, smoke, integration, live-provider and MCP protocol tests; executable modules
and tests from the independent top-level `mcp/` package; actual databases,
running external services, network requests, listening sockets and subprocesses.

## Behavioral analysis and unit boundaries

The server flow is request/loader/action → service → repository → DuckDB.
Tests choose a unit or a cohesive service/policy boundary and replace external
collaborators before use. They assert results, refusals and observable writes,
not successful application startup or real persistence. Existing focused
regressions are retained alongside the new PAGE-32 units.

| Boundary | Included success and failure behavior | Replaced collaborators |
| -------- | ------------------------------------- | ---------------------- |
| Authentication and sessions | Valid/invalid/inactive login, password changes, hash verification, throttle/expiry, own/foreign session revocation | User/session repositories, clocks; real local cryptographic functions use synthetic input |
| Authorization and administration | Active accounts, admin versus role mode, rank/capabilities, own/managed departments, project responsibility, group/role/user lifecycle, last-admin protection | Persisted account facts, authorization/user repositories, session and cache callbacks |
| Projects and work items | Creation/update/visibility, membership, archive/delete, integration settings, hierarchy/move/status/order, milestones, labels, checklist/history, refusal without writes | Repository methods or database query/transaction contracts; GitHub publication |
| Wiki | Read/search, page creation/version/restore, revisions/conflicts, anchors, move/trash, comments, uploads/covers, maintenance and private/project rights | Wiki/project repositories, file storage, visibility lookup and clocks |
| Pages Agent API and pairing | Input/size/range/patch validation, Unicode/conflicts/replay, current rights, operation dispatch, device approval/CSRF/expiry/polling/throttle, token eligibility and connection scopes | Repository/token/identity facts, filesystem metadata, credential/provider callbacks; no independent MCP executable imports |
| Providers and agent adapters | Synthetic model catalogs and output parsing, reasoning options, request/response/error mapping, cancellation and timeout behavior | Fetch/HTTP callbacks, CLI spawn, process table/signals and filesystem; the existing ACP adapter fake runs in process without a real child or MCP transport |
| Request processing | Middleware, signed session/language cookies, redirects, JSON budgets, form/image/SVG validation, settings/user actions and focused resource routes | Service factories, runtime and handler collaborators; Requests/Responses are local objects |
| Configuration and runtime | Config parsing/defaults/invalid values, bootstrap/setup-location refusal, secret handling, cache/queue behavior, static paths and server error dispatch | Config files, database inspector, filesystem, request listener and server listen; no port is opened |
| Pica Mobile endpoint | Frame parsing with version/shape/type rejections; authentication gating, heartbeat, session revalidation, rate and queue limits, log redaction; listener bind, move, failed-move retention and shutdown; port settings with permission and persistence; connections route loader/action | Fake HTTP and WebSocket servers that open no socket, fake authenticator, memory configuration files, mocked authentication and runtime services |
| Repository and shared contracts | Focused archive/deletion/chat/Discord persistence contracts, typed mapping/guards, error classes and limits | Query/execute/transaction fakes; schema guards only read repository-owned migration text |

The CredentialStore safety tests use synthetic metadata and mode changes at the
`node:fs/promises` boundary, including links, owner-only modes, cleanup isolation
and filesystem refusal. They no longer create temporary directories. Scope and
schema guards only read repository sources/manifests, never user content.

Names such as `project-service-integration.unit.test.ts` describe project
integration **settings**, not an integration-test kind: persistence is mocked,
no GitHub request is sent. Discord tests use a synthetic API behind mocked fetch.
Pages-owned `backend/service/mcp/` and `backend/auth/McpActorContext.ts` are
server authorization/business logic; their tests are not MCP protocol tests.
No MCP server, client, transport or process is started, even through helpers.
Pages connection instructions may read only static `mcp/package.json` metadata.

## Diagnostic coverage

The command writes statements, branches, functions and lines for each included
source module, including executable modules that no test imports. There is no
minimum percentage, threshold or coverage-ignore comment. The broad source
includes remain unchanged: Backend source, server exports and mixed route
modules under `app/`, shared definitions and language code. Mixed routes/client
utilities therefore leave UI code uncovered in the Backend report. Read that
as scope context, not as a reason to remove files or aggregate Frontend coverage.

Generated, gitignored reports under `coverage/backend/`:

- `coverage.txt`: per-module table with uncovered line numbers.
- `index.html`: browsable sources and branch gaps.
- `coverage-final.json`: statement/function/branch counters.
- `coverage-summary.json`: all four metrics overall and per module.

See [shared coverage includes and exclusions](../README.md#diagnostic-coverage).

## Recorded PAGE-32 run

The rebuilt suite passes with **4,246 tests in 244 files**, zero failed tests,
using `pnpm run test:backend` (Node/V8). The continuation started from a saved
work-in-progress with 4,210 passes and one Avatar fake mismatch; that fake was
corrected to return the same stored image fields as the real repository.

| Metric | Covered / total | Coverage |
| ------ | --------------- | -------- |
| Statements | 11,915 / 24,410 | 48.81% |
| Branches | 7,436 / 15,594 | 47.68% |
| Functions | 3,149 / 6,533 | 48.20% |
| Lines | 11,325 / 22,960 | 49.32% |

These are observations, not acceptance thresholds. In this report, **242
executable source modules have zero covered statements**. Notable remaining
Backend gaps include `SetupService.ts`, `SetupDatabaseWriter.ts`,
`SetupWizardService.ts`, `SettingsService.ts`, `TaskTemplateService.ts`,
`HealthService.ts` and many SQL repository paths. `Database.ts` has only 3.80%
statement coverage: actual DuckDB/migration execution is deliberately not claimed
by mocked repository tests. `WikiFileStore.ts` has 7.54% statements; service tests
replace file persistence and do not verify actual filesystem behavior.
`WikiService.ts` has 52.45% statements and 39.58% functions; facade methods and
some execution/lifecycle paths elsewhere remain untested even where a focused
policy or operation is covered. These gaps can be addressed by future isolated
units without adding database, provider or filesystem integration to this scope.

Authentication and session services, the connection scope policy, actor-channel
policy, ticket-department policy and CredentialStore each have 100% of all four
metrics in this run. That does not imply application-level security or functional
coverage of their mocked collaborators. Remaining uncovered branches and exact
line locations are listed in `coverage.txt` and the HTML report. Shared client
utilities and mixed route UI also account for intentional Backend report gaps;
Frontend results are not inferred or added to these figures.
