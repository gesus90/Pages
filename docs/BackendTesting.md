# Backend unit-test foundation

The backend has one independent [Vitest configuration](../vitest.backend.config.ts)
and one full-run entry point:

```sh
pnpm install --frozen-lockfile
pnpm run test:backend
```

Vitest and `@vitest/coverage-v8` are pinned together to `5.0.3`. No browser
environment, UI package or additional coverage provider is added. The CI entry
point is described below. The configuration imports no application
configuration or runtime entry point;
the React Router and Tailwind Vite plugins are not loaded. Node and the `@/`
repository alias are configured directly. Tests will live next to their modules
as `backend/**/*.test.ts` or `backend/**/*.spec.ts`, with explicit imports from
`vitest`. Those paths already belong to TypeScript and the full typed ESLint
rules; the new configuration and report script are included as well.

The implementation assignment explicitly forbids adding test files and running
tests, coverage, lint, typechecks, formatting checks or builds. Consequently
this foundation contains no test file, including no demonstration test. The
empty collection remains an error (`passWithNoTests: false`); it is not a
successful backend run. The first isolated behavior example and its execution
require separately authorized validation.

## Measurement scope and artifacts

The full-run command uses V8 coverage and prints the standard per-file table
for statements, branches, functions and lines, including fully covered files.
Its explicit include is `backend/**/*.{ts,tsx,mts,cts,js,mjs,cjs}`. Unimported
modules remain in scope; determining their coverage does not execute them.
Only test files and `.d.ts`/`.d.mts`/`.d.cts` declarations are excluded. There
are no executable-module exclusions or coverage-ignore comments. The same
include and exclude constants drive the independent source inventory.

Output goes into the ignored `coverage/backend/` directory. Vitest cleans it
at the beginning of a run, so old output cannot establish a new result.

| Artifact                | Purpose                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------ |
| `coverage-final.json`   | Raw statement, branch and function counters and source locations.                                      |
| `coverage-summary.json` | Per-file totals, covered counts and percentages for all four metrics.                                  |
| `scope-inventory.json`  | Complete source inventory with section, status and measured counters; missing sources remain explicit. |
| `first-section.tsv`     | Every first-section module, its status and all four metrics.                                           |
| `second-section.tsv`    | Every GitHub, security and setup module, its status and all four metrics.                              |
| `remaining-backend.tsv` | Every remaining backend module, with open work separated from the mandatory sections.                  |

After a successful Vitest process, `scripts/backend-coverage-report.ts` reads
the summary back, validates its shape and reconciles it against the source
files. An executable module with no reported counters, or no instrumentable
items in any metric, is `missing` and makes the command fail. An incompletely
covered module is `open`; complete counters produce `covered`. Remaining
backend modules have no percentage gate yet, but their measurements must exist.
The separate inventories contain every source module, not just open ones.
After writing them, the report also rejects any `open` first- or second-section
module using its exact counters, independently of the runner's percentage
thresholds.

Only source files syntactically containing type/interface declarations,
type-only imports/exports, empty statements or an empty local export can be
`not-applicable` when they have no instrumentable items. The report parses
source without evaluating it; a module with runtime statements cannot gain
this status just because its coverage is empty. A metric with zero total items
is displayed as `n/a`, rather than claiming that runtime behavior was covered.

At the original foundation base revision
`7c2bc1f7c1bcd533e25f36748db20f84d46a0b72`, the source inventory contained
1,921 modules: seven in the first section and 1,914 in the remaining backend.
The current second-section base revision `ada58b71` contains 1,930 modules:
seven in the first section, 19 in the second section and 1,904 in the remaining
backend. There are 54 syntactically type-only modules in the remaining backend;
they stay listed as not applicable when no executable items exist. The only
separate declaration file is `backend/database/postgres/pg.d.ts`, which has no
executable lines. No module in the first or second section is type-only. These
are source counts, not measured coverage results. The generated inventories
recalculate the population on every successful run instead of freezing this
snapshot as an allowlist.

Vitest also writes its standard reports when tests fail
(`reportOnFailure: true`). The scope postprocessor runs only after Vitest
succeeds; no scope-inventory result is claimed for a failed run. Shell `&&`
preserves Vitest's nonzero exit status and also propagates report-script
failures. Vitest's built-in per-file threshold evaluation supplies the failure
when a configured minimum is missed. This wiring was read in the configuration,
package command and installed runner source; failure injection was not run.

## CI

`.github/workflows/backend-tests.yml` is the repository's backend CI entry
point. Its only trigger is a push to `main`; there is no pull-request, tag,
schedule or manual trigger. Static checks are not part of this job.

The job uses `ubuntu-latest` with Node.js 24, installs the pnpm version from
`packageManager` and runs `pnpm install --frozen-lockfile`. It then executes
`pnpm run test:backend`. The workflow names no module, source glob or coverage
threshold: it runs the checked-out configuration, so a module added to the
measurement scope is measured in the next run without a CI list edit. The
configuration and the report script remain the single source of scope and
thresholds.

Vitest writes its usual text table for statements, branches, functions and
lines to the run log. The following step repeats the complete
`first-section.tsv`, `second-section.tsv` and `remaining-backend.tsv` tables in
the GitHub job summary, using the checked-out revision. The remaining backend
is measured but has no percentage gate yet; both mandatory sections keep their
per-module thresholds. Type-only modules stay visibly `not-applicable`, and an
executable module without measurements still fails the report step.

The artifact `backend-coverage-<commit>` contains `coverage-final.json`,
`coverage-summary.json`, `scope-inventory.json`, all three TSV tables and
`checked-out-commit.txt` with the Git revision checked out by the job. It is
uploaded even when the test or report step fails, so a failed run keeps its
diagnostics. The summary and upload steps do not mask failures: a failed
install, test or coverage report leaves the job red.

The current checkout has no backend test file. With `passWithNoTests: false`,
`pnpm run test:backend` therefore fails on this revision; the workflow reports
that state instead of weakening the check. The first behavior package has to
add tests under the configured patterns.

## Growing the mandatory sections

The first section covers every executable module below `backend/discord/`,
`backend/cache/` and `backend/concurrency/`, including future additions:

- `backend/discord/DiscordApiClient.ts`
- `backend/discord/DiscordConfig.ts`
- `backend/discord/DiscordMessage.ts`
- `backend/discord/DiscordPermissions.ts`
- `backend/cache/ServerCache.ts`
- `backend/cache/WorkItemScopeKey.ts`
- `backend/concurrency/SerialQueue.ts`

`FIRST_SECTION_MINIMUM` sets all four metrics to **100** with `perFile: true`
on that section's glob, including future modules. The foundation originally
prepared the gate at zero; the complete first section now requires 100%
statements, branches, functions and lines for each executable module. This
is an enforced requirement, not a measured coverage achievement. No behavior
suite or coverage baseline has been collected under the implementation
assignment's restrictions. Do not lower an established minimum, substitute
an aggregate average, add exclusions or insert coverage-ignore comments.
Thresholds are reviewed source changes; automatic configuration rewriting
is not enabled.

The second section covers every executable module below `backend/github/`,
`backend/security/` and `backend/setup/`:

- `backend/github/GitHubApiClient.ts`
- `backend/github/GitHubGitAccess.ts`
- `backend/github/GitHubRepositoryName.ts`
- `backend/github/GitHubRepositoryReadClient.ts`
- `backend/github/GitHubSyncScheduler.ts`
- `backend/github/GitHubTokenCrypto.ts`
- `backend/github/GitHubTokenKey.ts`
- `backend/security/AgentBrowserSecrets.ts`
- `backend/security/AgentCredential.ts`
- `backend/security/AgentTextSafety.ts`
- `backend/security/IdentityText.ts`
- `backend/security/InstanceSecretCipher.ts`
- `backend/security/McpDeviceCredential.ts`
- `backend/setup/SetupConnection.ts`
- `backend/setup/SetupDatabaseWriter.ts`
- `backend/setup/SetupIntent.ts`
- `backend/setup/SetupPostgresRepository.ts`
- `backend/setup/SetupService.ts`
- `backend/setup/SetupWizardService.ts`

`SECOND_SECTION_MINIMUM` likewise sets all four metrics to **100** with
`perFile: true` on the second glob, including future additions. The separate
[GitHub, security and setup inventory](BackendGitHubSecuritySetup.md) records
each module's behavior, boundaries, validation state and the open areas.

The [Discord, cache and concurrency inventory](BackendDiscordCacheConcurrency.md)
records the first section's behavior, external boundaries, the cache quota
correction and its original permitted direct execution evidence.

For later packages, retain the complete backend include, add a scoped per-file
threshold after the package is proven, and extend the inventory's section
classification when another separate section is needed. Unfinished sections
remain visible without acquiring a premature 100% global gate. Keep one Vitest
configuration and reuse the existing static-rule coverage.

Tests must use isolated inputs and mock external boundaries before importing
modules with runtime dependencies. Discord's fetch boundary, cache transaction
callbacks, logging and configuration must not reach real services or instance
data. Restore mocks, environment and global stubs; the configuration provides
automatic cleanup and preserves file isolation. `.only` is forbidden.

## Runtime and validation evidence

The initial worker cap and coverage processing concurrency are both two,
with fork isolation retained. These are conservative resource limits for a
small initial suite, not benchmark-derived optimal values. No test runtime,
coverage runtime, complete-run memory figure or fixed performance limit is
claimed. Before tuning, measure repeated complete runs on the same revision,
retain cold and warm results separately, and record CPU, peak memory, wall
time, test/transform/environment timings and coverage time. Compare worker
counts with identical assertions, scope and thresholds. Use Vitest's
`DEBUG=vitest:coverage` diagnostics to locate coverage bottlenecks; preserve
all unimported modules while changing execution resources.

Implementation environment on 2026-11-16: Linux `7.0.0-43-generic`, x86_64,
Node `24.22.1`, pnpm `11.23.0`, Vite `7.3.6`, 16 online logical processors,
`MemTotal: 23805248 kB`. Package engine requirements remain unchanged.

| Actual action                                                                              | Result                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm add --save-dev --save-exact vitest@5.0.3 @vitest/coverage-v8@5.0.3 --ignore-scripts` | Exit 0, pnpm reported 4.1 s; lockfile additions preserve existing dependency versions and install policy.                                                                                                                                                                                                                                                                                     |
| Direct `node --import tsx --input-type=module` invocation under shell `time`               | Exit 0; at the foundation snapshot, imported the configuration and report module, enumerated 1,921 sources and reconciled an explicitly empty input. All seven first-section modules stayed `missing`; 1,914 remaining modules and 53 type-only modules were visible. No runner, instrumenter, application module or service was started.                                                     |
| Direct invocation after adding the second section                                          | Exit 0; enumerated 1,930 sources with seven first-section, 19 second-section and 1,904 remaining modules; 54 type-only modules stayed outside the mandatory sections. Empty metadata left all mandatory entries `missing`, and both configured metrics are 100 with `perFile: true`. No runner, instrumenter, application module or service was started and no coverage artifact was written. |
| Second direct invocation with representative report metadata                               | Exit 0; partial counters became `open`, complete counters became `covered`, and absent or all-zero counters for executable modules stayed `missing`. Invalid summary structure was rejected with `ZodError`. These are supplied inputs, not measured coverage. The installed lockfile matched the repository lockfile byte for byte.                                                          |
| Resource observation for that direct invocation only                                       | 1.978 s wall, 2.88 s user CPU, 0.23 s system CPU; inventory portion 1,028.18 ms; Node reported peak RSS 428,260 KiB. This exercises the worst-case source parsing for an empty input, not a backend suite.                                                                                                                                                                                    |
| Attempted `/usr/bin/time` wrapper                                                          | Exit 127: GNU time is absent; the shell's built-in `time` and Node's `process.resourceUsage()` supplied the observation instead.                                                                                                                                                                                                                                                              |

The direct invocation used `buildBackendCoverageInventory(process.cwd(), {})`
and `collectBackendCoverageSources(process.cwd())`, printing the configuration,
section counts, type-only paths, elapsed inventory time and resource usage.
It wrote no coverage artifact. The source was also read through from the
package command to Vitest, then through summary validation, scope comparison,
section output and nonzero error propagation.

The lockfile candidate's SHA-256 is
`551f3372123e97da608bcad9579e2bbf8bfb375fc2b3b6431062cc9278bc9139`.
Both direct invocations used the implementation source on the base revision
identified above; the final local commit identifies the complete change.

The following requested validation items are administratively handed to final
QA and are **nicht ausgeführt (Vorgabe Igor)**: demonstration test creation;
`pnpm run test:backend`; lint; TypeScript check including future test files;
formatting check; build; actual coverage artifact readback; controlled failed-test
and below-threshold runs; full-run runtime/resource measurement and bottleneck
tuning. Their execution is also why no actual GitHub Actions run, artifact
download or job-summary readback is claimed: publication is outside this
assignment. They have no claimed exit codes or successful results. No live
service, production data, credential, push, branch switch or rebase was used.
Functional coverage and both mandatory sections' 100% acceptance remain
unmeasured.

Configuration references: [Vitest coverage](https://vitest.dev/config/coverage),
[worker limits](https://vitest.dev/config/maxworkers) and
[file isolation](https://vitest.dev/config/isolate).
