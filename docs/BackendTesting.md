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

The full-run command uses V8 coverage. After the runner and inventory checks
succeed, it prints a compact table for the adopted modules with statements,
branches, functions and lines, including fully covered and unimported files.
The table is generated from `BACKEND_COVERAGE_SECTIONS`, which also supplies
the per-file thresholds. Vitest's full-backend text reporter is disabled; its
JSON reporters retain the complete measurement scope. The explicit include is
`backend/**/*.{ts,tsx,mts,cts,js,mjs,cjs}`. Unimported modules remain in scope;
determining their coverage does not execute them.
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
| `adopted-backend.tsv`   | Validated table of all adopted modules; identical content is printed locally and used by CI.           |

After a successful Vitest process, `scripts/backend-coverage-report.ts` reads
the summary back, validates its shape and reconciles it against the source
files. An executable module with no reported counters, or no instrumentable
items in any metric, is `missing` and makes the command fail. An incompletely
covered module is `open`; complete counters produce `covered`. Remaining
backend modules have no percentage gate yet, but their measurements must exist.
The separate inventories contain every source module, not just open ones.
After writing them, the report also rejects any `open` adopted module using
its exact counters, independently of the runner's percentage thresholds. Only
after both missing-measurement and completeness checks pass does it write
`adopted-backend.tsv` and print that table. The remaining backend stays in the
artifacts, with only a module count and artifact path printed to the log.

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
`BACKEND_COVERAGE_SECTIONS` array is the single source for adopted sections,
their thresholds and their report classification.

The report script prints `adopted-backend.tsv` to the run log. The following
step repeats exactly that table in the GitHub job summary, using the checked-out
revision. It has no separate list of sections. The remaining backend is measured
but has no percentage gate yet and no table in the summary. Both adopted
sections keep their per-file thresholds. Type-only modules stay visibly
`not-applicable`, and an executable module without measurements still fails
the report step. If no validated table exists, the summary says so and points
to the test step outcome; an empty or failed run produces no success table.

The artifact `backend-coverage-<commit>` contains `coverage-final.json`,
`coverage-summary.json`, `scope-inventory.json`, all section TSV tables,
`remaining-backend.tsv`, `adopted-backend.tsv` (after successful validation) and
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

The first `BACKEND_COVERAGE_SECTIONS` entry sets all four metrics to **100**
with `perFile: true` on that section's glob, including future modules. The
foundation originally prepared the gate at zero; the complete first section now requires 100%
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

The second `BACKEND_COVERAGE_SECTIONS` entry likewise sets all four metrics
to **100** with `perFile: true` on the second glob, including future additions.
The separate
[GitHub, security and setup inventory](BackendGitHubSecuritySetup.md) records
each module's behavior, boundaries, validation state and the open areas.

The [Discord, cache and concurrency inventory](BackendDiscordCacheConcurrency.md)
records the first section's behavior, external boundaries, the cache quota
correction and its original permitted direct execution evidence.

For later packages, retain the complete backend include and add one entry to
`BACKEND_COVERAGE_SECTIONS` with a unique section name, its source glob and the
required minimum of 100. That entry supplies all four per-file thresholds,
source classification, the separate section TSV and the adopted table in both
local output and CI. No report-script or workflow list edit is needed.
Unfinished sections remain in the separate inventories without acquiring a
premature global gate. Keep one Vitest configuration and reuse the existing
static-rule coverage.

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

## Discovery investigation and compact-output verification

Inspected on 2026-11-16 at base revision
`3499e05d75d15124a2588bb55f0e7d6c8f59a4b1`, with a clean initial working tree
on the prepared session branch in `/home/igor/Repo/Pages-Session-4`.
The local implementation commit identifies the resulting configuration and
report changes. Both adopted sections are present: seven Discord, cache and
concurrency modules and 19 GitHub, security and setup modules. Their earlier
implementation inventories explicitly record that no test files were added.
Completion of those implementations does not establish an executed suite.

The reported checkout `/home/igor/Repo/Pages-2` was inspected read-only with
`GIT_OPTIONAL_LOCKS=0` for Git commands. At both observations its branch was
`main`, its revision was the same base revision above and `git status --short`
was empty. Its original backend configuration matched the session's original
configuration byte for byte. The package command matched, and both lockfiles
had the SHA-256 recorded above. No files, index, branch, dependencies or running
writers in that checkout were changed. These are observations of its current
state; they cannot reconstruct the unknown revision of the earlier run.

Neither checkout contained a file matching `backend/**/*.{test,spec}.ts`.
The session's directly imported configuration resolves its root to the
repository directory independently of the shell's working directory. A direct
`globSync(BACKEND_TEST_GLOB, { cwd: root })` returned an empty array. No
discovery-pattern defect was found: there are no matching files to discover.
The installed Vitest source reports `No test files found, exiting with code 1`
when `passWithNoTests` is false, as configured here. The package's shell `&&`
then prevents the inventory postprocessor and its success table from running.
No test files, discovery bypass or placeholder suite were added. The earlier
run's exact inputs, environment, filters and cause remain unavailable; absent
test files explain the currently inspected source population, not a proven
reproduction of that historical invocation.

The session uses Node `24.22.1` and pnpm `11.23.0`. Its initial dependency tree
did not contain Vitest. The first `pnpm install --frozen-lockfile --ignore-scripts`
attempt exited 1 because pnpm required a TTY for replacing that tree.
`CI=true pnpm install --frozen-lockfile --ignore-scripts` then exited 0,
installing the pinned dependencies without lifecycle scripts or lockfile changes.
No test runner or coverage provider was started.

Permitted direct functional invocations used
`node --import tsx --input-type=module` with inline supplied inputs; both exited 0. They imported only the configuration and inventory script, without loading
application modules:

- Source enumeration found 1,930 modules. The adopted formatter retained all
  26 adopted rows and excluded the 1,904 remaining modules from that table.
  Both threshold objects still had `perFile: true` and 100 for all four metrics.
  Empty supplied metadata left all 26 executable adopted modules `missing`.
  Supplied complete counters produced `covered`, partial branch counters
  produced `open`, a zero-item metric printed `n/a`, and malformed metadata
  raised `ZodError`.
- The complete writer was invoked with supplied counters and filesystem writes
  redirected to an in-memory map. It retained the full 1,930-entry JSON
  inventory and all three existing TSV inventories, then produced a 26-row
  `adopted-backend.tsv` identical to its console table. The remaining TSV kept
  1,904 rows. Repeating that direct invocation with partial or absent counters
  for `ServerCache.ts` raised the existing completeness or missing-measurement
  error, respectively, and produced no validated adopted table. These supplied
  counters are illustrative input, not measured coverage; no coverage artifact
  was written to disk.

The changed flow was also read from configuration through the package command,
JSON reporters, source enumeration, dynamic section selection, validation,
table emission and workflow summary. The full-backend JSON reporters, missing
measurement check, exact-counter gate, `passWithNoTests: false`, `.only` ban,
failure propagation, artifact upload and sole push-to-main trigger remain.
The workflow now reads only the generated adopted table and needs no new list
when a section is added to the configuration.

`pnpm run test:backend`, tests, coverage, failed-test/threshold runner executions,
lint, TypeScript checks, `pnpm run check`, build and formatting checks:
**nicht ausgeführt (Vorgabe Igor)**. Those requested validation activities are
administratively complete under the assignment override; they have no claimed
exit code, executed test count or measured percentage. No GitHub Actions run
was performed or reported as passed. No live services, live data, credentials,
push, merge, rebase or branch switch were used.

Configuration references: [Vitest coverage](https://vitest.dev/config/coverage),
[worker limits](https://vitest.dev/config/maxworkers) and
[file isolation](https://vitest.dev/config/isolate).
