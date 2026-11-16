# Inventory of the test and CI removal

Recorded on 2026-11-16 in the prepared, isolated session checkout. The starting
revision was `2da8ad2fbf8455208344a3cc5a490c071765fc8e`; the working tree was
clean. No branch switch, rebase, push, merge, deployment, credential change or
live-data operation was performed. The resulting revision is the local commit
containing this inventory (`git log -1 --format=%H -- docs/TestCiRemoval.md`).

This is a historical removal record, not a description of the current CI or
test foundation. The current [backend foundation](BackendTesting.md) and
[documentation audit](TestCiDocumentationAudit.md) describe subsequent work.

## Inventory and disposition

The inventory covered all 7,149 tracked files, hidden configuration, source
outside the central test directory, scripts, deployment definitions, Rust
modules, package manifests and both lockfiles. Searches used `git ls-files`,
`rg --files --hidden` and `rg -n` with dependency directories and `.git` excluded.
They included test/spec filenames; test, fixture, mock and snapshot directories;
Vitest, Jest, Playwright, Cypress and Testing Library; Node test/assert imports;
Rust test attributes; smoke/proof entry points; CI configuration, workflow
triggers, test tags, coverage, reporting and obsolete package script names.
Every filename match outside the removed directories was inspected for its
actual purpose. No Rust tests or additional CI configuration were found.

| Population at the starting revision                                                                            | Treatment                                                                                                                                                              |
| -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1,653 files under `tests/backend/`                                                                             | Removed, including unit/API/contract/regression cases, mocks, fixtures, setup and reports/documentation of this scope.                                                 |
| 611 files under `tests/frontend/`                                                                              | Removed, including component/hook cases, mocks, fixtures and setup.                                                                                                    |
| 67 files under `tests/browser/`                                                                                | Removed, including browser/E2E/visual cases, probes, server support, configuration and expected images.                                                                |
| The test directory's overview                                                                                  | Removed together with all 2,332 files under `tests/`.                                                                                                                  |
| 63 files under `scripts/postgres-check/`, plus its entry point and the conversation database-check entry point | Removed all schema/parity/repository/concurrency regression checks and seeded test worlds. Extracted only the utilities used by operating commands, as detailed below. |
| `scripts/acp-smoke.ts`, `scripts/agent-group-proof.ts`, `scripts/agent-group-proof-setup.ts`                   | Removed the standalone live-provider smoke and shared-session proof programs.                                                                                          |
| Three `vitest.*.config.ts` files                                                                               | Removed runner discovery, environments, setup and coverage configuration.                                                                                              |
| Browser runner and declaration, CI coverage summary script                                                     | Removed browser provisioning/report generation and coverage reporting; preserved the shared command lifecycle independently.                                           |
| `.github/workflows/ci.yml`                                                                                     | Removed both check and test jobs and all push-to-main, pull-request, reusable-workflow and test-tag triggers. No workflow remains in this tree.                        |

In total, 2,407 old files were deleted. The six removed package scripts are the
two unit scopes, browser suite, PostgreSQL regression check, conversation
regression check and ACP smoke command. TypeScript includes, ESLint populations
and browser-result classification no longer reference those files or scopes.
All existing static rule severities and limits remain unchanged.

Removed direct development dependencies: `vitest`, `@vitest/coverage-v8`,
`@playwright/test`, `@testing-library/dom`, `@testing-library/react`, `jsdom`.
`pnpm install --lockfile-only --ignore-scripts` exited **0**. pnpm pruned 70
package records (839 to 769) and 665 lockfile lines, without adding package
versions. No test-only package remains in the lockfile. Product dependencies
and the versions of remaining development dependencies are unchanged.

## Retained shared and product functions

| Remaining match or utility                                                                                              | Concrete reason                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `playwright-core`, browser caches and agent tool installation                                                           | Pica's administrator/operator browser and browser automation use them in the product. The separately installed agent tool is also a runtime capability. Removing them would break product behavior.                                                                              |
| `postgres:restore-check`, its backup, WAL and restored-instance modules, and deployment backup services/timers          | These verify actual operating backups and publish backup status. They are not the removed regression suite. They were not executed.                                                                                                                                              |
| `scripts/postgres-restore-check/postgres-programs.ts`                                                                   | Retains only program execution, free-port selection, process discovery and owned-process lifecycle used by backup restoration. The test-cluster class, initializer, passwords and regression-program preflight are gone. Its imports no longer point into the deleted directory. |
| `db:transfer`, `@duckdb/node-api`, migration reader and historical DuckDB migrations                                    | Required for offline data transfer. Its six-type mapping now belongs directly to `scripts/db-transfer/table-plan.ts`; the catalog/parity test implementation was removed.                                                                                                        |
| `scripts/qa-evidence.mjs` and declarations                                                                              | Retains dependency preflight and source fingerprinting used by general session/merge work. Removed coverage populations, counters, freshness checks and coverage-dependent handoff acceptance.                                                                                   |
| `scripts/command-step.mjs` and declaration                                                                              | The existing cancellable command lifecycle is used by dependency setup. It was extracted from the browser runner without changing its behavior. No browser provisioning/reporting remains here.                                                                                  |
| `scripts/command-temporary-directory.*`, source population and lint runner                                              | Used by dependency setup, source fingerprints or retained static checks. They are shared development functions.                                                                                                                                                                  |
| `coverage/` in ignore/generated-output classification                                                                   | Preserves earlier generated evidence without including it in source/static-check populations. It installs or runs no coverage tool and defines no coverage population. No existing generated reports were deleted.                                                               |
| Remote/GitHub connection test routes and services, remote test UI, speech preview, integration health checks            | User-facing configuration and connectivity features. These execute product operations, not repository test cases.                                                                                                                                                                |
| Remote directory protocol markers containing `pages-check` and the chat activity classifier recognizing test-tool names | Product protocol output and display classification of user activity; neither starts CI or a test runner.                                                                                                                                                                         |
| Names containing `Specification`, `Status`, `Snapshot`, `latest`, regular-expression `.test()` or editor `.spec`        | Product contracts, current state, runtime snapshots, routes, regular-expression matching or editor APIs; not test files.                                                                                                                                                         |
| Native candidate build scripts and their upstream offline patch                                                         | Product artifact builders. The patch refers to an upstream binary-version smoke step that it disables for offline packaging; it does not install a Pages test.                                                                                                                   |
| Existing baseline migration comment mentioning the former database check                                                | Historical comment in an applied migration. The migration bytes are preserved to avoid changing recorded migration checksums. No code invokes that command.                                                                                                                      |
| Generic Python `unittest` example in the script-runtime guide                                                           | Illustrates a user-supplied external project's script report, not an existing Pages suite or executable test infrastructure.                                                                                                                                                     |

## Documentation and writer coordination

The separate documentation-cleanup work was read before editing and again
before closeout. It is still in progress and reports a local documentation
commit in another session; that commit is not assumed to exist in this
checkout. No other checkout or writer's files were modified, imported or reset.

Only the direct transition dependencies were adjusted here: agent instructions,
root README, development guide, documentation index, database operations guide,
agent-runtime smoke instructions and calendar verification state. They now
state that the old suites/CI are absent, preserve operating instructions and
avoid directing users to removed entry points. These overlapping guide edits
must be reconciled with the separate documentation branch when an authorized
operator combines the work; neither side's changes should be discarded.

Remaining old test paths and commands in specialized Markdown and JSON reports
record earlier implementations or measurements. They are retained historical
evidence, not runnable contracts or proof for the current source. Their broader
editorial cleanup belongs to the separate documentation work; no report was
deleted merely to satisfy a gate. The residual set is reproducible with:

```sh
rg -l 'tests/|vitest\.|test:backend|test:frontend|browser:test|postgres:check|postgres:conversation-check|acp:smoke|agent-group-proof|ci_test' --glob '*.md' --glob '*.json' --hidden -g '!node_modules/**' -g '!.git/**'
```

The results consist of this inventory, historical/specialized implementation
notes and reports, plus the generic external-project example described above.
The source and executable-configuration scan has no obsolete test imports,
commands or scope references. Historical evidence cannot demonstrate current
behavior after the suites have been removed.

## External CI, plans and remaining authorized actions

GitHub was inspected read-only with `gh api repos/gesus90/Pages/...`:

| API path suffix                               | Exit code | Observation                                                                                 |
| --------------------------------------------- | --------- | ------------------------------------------------------------------------------------------- |
| `branches/main/protection`                    | 1         | HTTP 404, explicitly `Branch not protected`.                                                |
| `rulesets` and `rules/branches/main`          | 0 each    | Both return empty arrays; no required-check rule was reported.                              |
| `hooks` (selected fields only)                | 0         | Empty array; no repository webhook was reported.                                            |
| `actions/permissions`                         | 0         | Actions remains enabled with all actions allowed.                                           |
| `actions/workflows`                           | 0         | Remote workflow `ci` remains active until an authorized publication removes or disables it. |
| `actions/runs?status=in_progress&per_page=20` | 0         | No in-progress run at inspection time.                                                      |
| `actions/runs?status=queued&per_page=20`      | 0         | One older queued run, ID `43098096589`; it was not cancelled.                               |
| `git/matching-refs/tags/ci_test`              | 0         | Eight historical remote tags; none was rewritten or deleted.                                |

The removed workflow declared check names `Pages check` and `Pages tests
(100% coverage)`. External callers must stop expecting these statuses. An
owner must review required checks again at publication time, reconcile the
queued run, and decide whether to disable Actions/the old workflow during the
transition. Old tags and historical commits can still expose the old workflow
for reruns; deleting the file in this new commit does not rewrite that history.
No global Actions setting, remote tag or queued run was changed.

Visible Pages plans were read with their current revisions, without editing or
starting them:

| Plan                           | Revision          | Impact                                                                                                                                                                                                                 |
| ------------------------------ | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pages Test                     | 7                 | Uses removed unit/browser/database commands, coverage reports, exact job/step names and the test-tag prefix. Must remain unused until replaced or updated.                                                             |
| Pages Backend Coverage 100%    | 9                 | Baseline, work loop, QA and closeout expect the removed backend suite and coverage evaluator. Requires replacement.                                                                                                    |
| Pages Backend Tests optimieren | 2                 | Baseline, work and QA expect the removed suite/configuration. Requires replacement.                                                                                                                                    |
| Pages Session 1 / 2 / 3 / 4    | 13 / 90 / 18 / 49 | QA nodes still describe targeted unit commands. Their dependency preflight and fingerprint commands remain supported; suite expectations need owner adjustment before reuse, including the current session's later QA. |
| Pages merge                    | 13                | No old suite/coverage command dependency was found in its serialized definition.                                                                                                                                       |
| Pages und MCP E2E Prüfstand    | 5                 | Separate external live-provider/tool acceptance plan; not repository test files. No execution or live configuration was changed.                                                                                       |

The daily 02:00 Europe/Berlin automation for `Pages Test` is already inactive
(revision 8, no next run). The other visible automation is also inactive.
Do not reactivate the old test automation before its plan is replaced. Existing
plan definitions and shared execution state are live application data, outside
this repository-only change. Updating them requires a separate authorized
operator action. Visibility of these reads does not prove the absence of other
privately owned plans or organization-level CI.

## Focused functional verification

Four temporary stdin-based checks were run. No check file, suite, runner or
new dependency was retained. Node's built-in assertions and module mocks were
used where needed; external process, filesystem and socket boundaries in the
backup check were mocked. No real database, provider, browser, API server,
worker unit or live service was started.

| Actual invocation                                                                                | Result                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node --experimental-test-module-mocks --input-type=module` with stdin assertions                | **Exit 0**: command success, nonzero exit, spawn error, cancellation, timeout and signal-listener cleanup; manifest ordering/deduplication/change detection; missing/stale/current dependency inspection; removed coverage/handoff exports absent. No subprocess was started.                                                                              |
| `node --import tsx --experimental-test-module-mocks --input-type=module` with stdin assertions   | **Exit 0**: restored-backup program success/failure/spawn error, environment filtering, loopback selection, process discovery, confirmed process ownership, idempotent shutdown and refusal of unconfirmed ownership. All external boundaries mocked.                                                                                                      |
| `node --import tsx --input-type=module` with stdin assertions                                    | **Exit 0**: six DuckDB type mappings and unknown-type passthrough, foreign-key order, primary keys, text sanitization in sort terms, identifier quoting and refusal of incompatible schemas/cycles. No external boundary invoked.                                                                                                                          |
| `node --input-type=module` with stdin assertions over the checkout and starting package manifest | **Exit 0**: 4,745 then-existing tracked/new files, 4,357 source files and 20 Rust modules; no old test files, workflow, test imports or test packages. Product dependencies, remaining dependency versions, start/build/static commands and build entry files match the starting revision. Only repository reads and Git inventory subprocesses were used. |

The checked implementation is identified by SHA-256
`61b1890fbc01a9ca06cb0252f3aef9b8b463dd806a6ad852791ff6b7224ab8fd`.
It hashes, in sorted path order, each UTF-8 path, NUL, file bytes and NUL for:
`scripts/command-step.mjs`, `scripts/db-transfer/table-plan.ts`,
`scripts/postgres-restore-check/postgres-programs.ts`, `scripts/qa-evidence.mjs`
and `scripts/source-population.mjs`. Documentation additions do not alter it.

Build, lint, check, typecheck, formatting checks, complete suites and coverage:
**an die Abschluss-QA übergeben**, as explicitly required by the assignment.
They were not executed and have no claimed exit code. Actual product startup,
rendering, live integration behavior, backup recovery and offline transfer
against real data were not exercised. Start/build entry preservation was
checked, but that is not a successful build or runtime-start claim. There is
currently no persistent automated behavioral coverage or repository CI.
