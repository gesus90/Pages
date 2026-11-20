# Auth and logging

The fourth mandatory section covers every executable module below
`backend/auth` and `backend/logging`. The section is part of
`BACKEND_COVERAGE_SECTIONS` in `vitest.backend.config.ts`, so test discovery,
V8 coverage and the per-file thresholds of 100% statements, branches, functions
and lines apply to it. Files that no test imports are included in the
measurement. None of the 32 modules is declaration-only.

Each module has its own test file next to it (`<Module>.test.ts`). The tests
simulate external boundaries: the database and repositories, the filesystem
where log files, locks and retention are involved, network requests, the clock,
process signals and environment variables, and the standard output streams.
Real filesystem work uses isolated folders below `pagesTempDirectory()` and
removes them after each test. No live service or instance data is used.

These unit tests do not prove operational or integration behavior. They do not
exercise a real PostgreSQL server, the permissions of the production
filesystem, live network endpoints, real process signals or the deployment
environment. Those boundaries stay with operations and integration checks.

## Production adjustments

Three modules changed behavior-neutrally, because a guard in each was
unreachable through the public call paths and could therefore not be covered by
any behavior test:

- `AccountAuthorizationLog.ts`: the eviction of the oldest account uses a loop
  that removes the first key, instead of an `undefined` guard on a key of a
  non-empty map.
- `DailyLogWriter.ts`: the log directory is passed to `acquire` and
  `writePending` by the caller. The directory is assigned once and never reset
  to `null`, so the removed guards could not be reached.
- `LogWriterLock.ts`: `writeIdentity` receives the file handle as a parameter.
  The caller always holds a non-null handle at that point.

## Measured state

Measured with `corepack pnpm run test:backend` on the commit
`53605329` with the changes of this assignment. Every executable module has
100% in each measurable metric. `n/a` means that the metric has no
instrumentable items in that module.

| Module                               | Statements     | Branches       | Functions    | Lines          |
| ------------------------------------ | -------------- | -------------- | ------------ | -------------- |
| `auth/AgentConnectionScopePolicy.ts` | 100% (10/10)   | 100% (7/7)     | 100% (3/3)   | 100% (7/7)     |
| `auth/AgentProfilePolicy.ts`         | 100% (23/23)   | 100% (20/20)   | 100% (6/6)   | 100% (19/19)   |
| `auth/AuthService.ts`                | 100% (32/32)   | 100% (16/16)   | 100% (7/7)   | 100% (32/32)   |
| `auth/BrowserSessionCookie.ts`       | 100% (1/1)     | n/a            | n/a          | 100% (1/1)     |
| `auth/LoginThrottle.ts`              | 100% (42/42)   | 100% (25/25)   | 100% (12/12) | 100% (42/42)   |
| `auth/McpActorContext.ts`            | 100% (2/2)     | 100% (6/6)     | 100% (2/2)   | 100% (2/2)     |
| `auth/PasswordHasher.ts`             | 100% (39/39)   | 100% (22/22)   | 100% (7/7)   | 100% (39/39)   |
| `auth/PermissionService.ts`          | 100% (39/39)   | 100% (33/33)   | 100% (8/8)   | 100% (37/37)   |
| `auth/ProjectPolicyService.ts`       | 100% (20/20)   | 100% (34/34)   | 100% (17/17) | 100% (19/19)   |
| `auth/SessionService.ts`             | 100% (54/54)   | 100% (29/29)   | 100% (16/16) | 100% (53/53)   |
| `auth/TemporaryPassword.ts`          | 100% (4/4)     | n/a            | 100% (3/3)   | 100% (3/3)     |
| `auth/TicketDepartmentPolicy.ts`     | 100% (2/2)     | 100% (7/7)     | 100% (1/1)   | 100% (2/2)     |
| `auth/UserAgent.ts`                  | 100% (17/17)   | 100% (8/8)     | 100% (3/3)   | 100% (17/17)   |
| `auth/UserPolicyService.ts`          | 100% (70/70)   | 100% (112/112) | 100% (30/30) | 100% (58/58)   |
| `auth/WorkItemTemplatePolicy.ts`     | 100% (17/17)   | 100% (22/22)   | 100% (7/7)   | 100% (17/17)   |
| `logging/AccountAuthorizationLog.ts` | 100% (25/25)   | 100% (10/10)   | 100% (5/5)   | 100% (20/20)   |
| `logging/DailyLogWriter.ts`          | 100% (141/141) | 100% (71/71)   | 100% (24/24) | 100% (129/129) |
| `logging/DatabaseLogMetrics.ts`      | 100% (53/53)   | 100% (20/20)   | 100% (15/15) | 100% (50/50)   |
| `logging/LogCalendar.ts`             | 100% (15/15)   | 100% (6/6)     | 100% (3/3)   | 100% (14/14)   |
| `logging/LogCorrelation.ts`          | 100% (2/2)     | 100% (6/6)     | 100% (2/2)   | 100% (2/2)     |
| `logging/LogError.ts`                | 100% (28/28)   | 100% (32/32)   | 100% (7/7)   | 100% (26/26)   |
| `logging/LogFallback.ts`             | 100% (7/7)     | 100% (7/7)     | 100% (2/2)   | 100% (7/7)     |
| `logging/LogFiles.ts`                | 100% (42/42)   | 100% (19/19)   | 100% (4/4)   | 100% (38/38)   |
| `logging/LogRedaction.ts`            | 100% (45/45)   | 100% (38/38)   | 100% (5/5)   | 100% (43/43)   |
| `logging/LogRetention.ts`            | 100% (61/61)   | 100% (29/29)   | 100% (11/11) | 100% (53/53)   |
| `logging/LogTiming.ts`               | 100% (3/3)     | 100% (8/8)     | 100% (1/1)   | 100% (3/3)     |
| `logging/LogWriterLock.ts`           | 100% (78/78)   | 100% (48/48)   | 100% (13/13) | 100% (72/72)   |
| `logging/LoggedOperation.ts`         | 100% (11/11)   | 100% (1/1)     | 100% (4/4)   | 100% (10/10)   |
| `logging/Logger.ts`                  | 100% (102/102) | 100% (91/91)   | 100% (19/19) | 100% (89/89)   |
| `logging/PollingLogPolicy.ts`        | 100% (11/11)   | 100% (6/6)     | 100% (4/4)   | 100% (9/9)     |
| `logging/RouteLogMetrics.ts`         | 100% (32/32)   | 100% (16/16)   | 100% (7/7)   | 100% (27/27)   |
| `logging/RunLogSink.ts`              | 100% (8/8)     | n/a            | 100% (3/3)   | 100% (8/8)     |

Totals of the complete run: 98 test files and 838 tests passed. The coverage
report lists 108 modules in the four sections: 7, 19, 50 and 32. Every module
is `covered`, and no module is `open` or `missing`.

## Remaining backend areas

These areas stay outside the mandatory sections and have no percentage gate.
The counts are source files without tests and declaration files, counted on
2026-11-20. They are not measured coverage.

| Remaining area | Source files | Behavior status |
| -------------- | ------------ | --------------- |
| `agents`       | 220          | open            |
| `database`     | 297          | open            |
| `error`        | 45           | open            |
| `runtime`      | 30           | open            |
| `service`      | 1,342        | open            |
