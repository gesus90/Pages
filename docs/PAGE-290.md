# PAGE-290: CI test tags, execution evidence

The job `Pages tests (100% coverage)` of `.github/workflows/ci.yml` runs only
for a pushed tag `ci_test` or `ci_test-<id>` (see [CI test tags](../tests/README.md#ci-test-tags-page-290)).
This file records the first observed runs. It separates two questions:

- **Is the CI implemented correctly?** Yes, as observed below: the tag started
  the job on the tagged commit, all ten steps ran in order, a failing suite did
  not stop the other one, the coverage steps measured raw counters and failed,
  and the job and the run are red.
- **Does the application have 100% coverage?** No. The measured gaps below make
  the job correctly fail. This ticket does not add tests to close them.

## Runs

Commit `c6f9971e9cb85ae73f0c548038cb179e53e3c046` (`PAGE-290: CI-Testjob mit
100%-Coverage per ci_test-Tag`). No tag was moved or deleted.

| Tag                  | Run                                                                      | Result                                                                                                                                                                        |
| -------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ci_test-c6f9971e`   | [42671052433](https://github.com/gesus90/Pages/actions/runs/42671052433) | Run `failure`; GitHub could not create the test job ("Internal server error", GitHub Actions major outage). Only `Pages check` ran (green), which proves nothing about tests. |
| `ci_test-c6f9971e-2` | [42672325471](https://github.com/gesus90/Pages/actions/runs/42672325471) | Run `failure` without any job, same outage.                                                                                                                                   |
| `ci_test-c6f9971e-3` | [42677258396](https://github.com/gesus90/Pages/actions/runs/42677258396) | Run `failure`; evaluated below.                                                                                                                                               |

## Steps of run 42677258396

Job [`Pages tests (100% coverage)`](https://github.com/gesus90/Pages/actions/runs/42677258396/job/129361865277):
`failure`. The step `Tagged commit` confirmed `HEAD` = `c6f9971e…`.

| Step                     | Result  | Observation                                                                                                                                                                                                                                                                         |
| ------------------------ | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Formatting`             | success |                                                                                                                                                                                                                                                                                     |
| `Check`                  | success |                                                                                                                                                                                                                                                                                     |
| `Lint`                   | success |                                                                                                                                                                                                                                                                                     |
| `Backend unit tests`     | failure | 650 of 651 test files passed. `tests/backend/backend/agents/cli/owned-namespace.unit.test.ts` › "records only the spawned supervisor identity and boot" failed with `Supervisor identity unavailable`. The same file passes locally (8/8), so it depends on the runner environment. |
| `Frontend unit tests`    | success | 320 of 320 test files passed; ran although the Backend suite had failed.                                                                                                                                                                                                            |
| `Browser tests`          | success |                                                                                                                                                                                                                                                                                     |
| `PostgreSQL check`       | success | Temporary PostgreSQL 18 instance on the runner.                                                                                                                                                                                                                                     |
| `Backend coverage 100%`  | failure | Raw counters below, 1416 files with gaps.                                                                                                                                                                                                                                           |
| `Frontend coverage 100%` | failure | Raw counters below, 1023 files with gaps.                                                                                                                                                                                                                                           |
| `Build`                  | success |                                                                                                                                                                                                                                                                                     |

The job `Pages check` of the same run succeeded; it is no evidence for tests or
coverage.

## Measured coverage

Reported by `node scripts/qa-evidence.mjs coverage` in the run; the only issues
were `incomplete:<metric>` for all four metrics (no population, staleness or
validity issue).

| Scope    | Statements    | Branches      | Functions    | Lines         | Files (with gaps) |
| -------- | ------------- | ------------- | ------------ | ------------- | ----------------- |
| Backend  | 32577 / 70454 | 21354 / 48777 | 8250 / 18084 | 30589 / 64561 | 2048 (1416)       |
| Frontend | 12309 / 25059 | 9489 / 20501  | 3735 / 8214  | 11255 / 22760 | 1375 (1023)       |

Skipped is 0 everywhere.

## Artifacts

Uploaded after the failed steps:

- `pages-coverage-backend-ci_test-c6f9971e-3`: 2162 files (`coverage.txt`,
  HTML, `coverage-final.json`, `coverage-summary.json`).
- `pages-coverage-frontend-ci_test-c6f9971e-3`: 1474 files, same report kinds.
- `pages-browser-reports-ci_test-c6f9971e-3`: the Playwright HTML report.
