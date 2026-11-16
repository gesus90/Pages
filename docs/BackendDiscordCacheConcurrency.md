# Discord, cache and concurrency

The backend foundation is retained with its complete source include, isolated
Node environment, explicit declaration/test-file exclusions and failing empty
collection. All executable modules below `backend/discord`, `backend/cache`
and `backend/concurrency` now require 100% statements, branches, functions and
lines individually. The glob includes future additions. No previous mandatory
section or established threshold is removed. The report additionally rejects
incomplete first-section counters after writing the inventories.

The assignment explicitly prohibits creating test files and executing tests,
coverage, lint, typechecks, formatting checks or builds. Those activities are
**nicht ausgeführt (Vorgabe Igor)** and administratively handed to final QA.
There is no unit suite, measured coverage, coverage artifact or successful
backend-test run to claim. The configured threshold does not imply coverage
has been achieved. The command will continue to fail on an empty collection.

## Executable module inventory

Every module below contains runtime code; none is declaration-only. The
following cases describe the current implementation and its relevant paths,
not executed unit-test cases.

| Module                          | Public behavior and relevant paths                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | External boundaries                                                                                                                                                                                                                                                                            |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `discord/DiscordApiClient.ts`   | `buildAuthorizationUrl` encodes the application, bot scope, requested permissions, redirect and OAuth state. `exchangeAuthorizationCode` posts form credentials and returns an optional guild id. `getGuild` validates guild facts and role permission integers. `getGuildChannels` accepts text/announcement channels, filters malformed entries and sorts by position/name. `getBotRoleIds` accepts string role ids. `createMessage` encodes the channel id and sends a stable nonce with duplicate enforcement. Each HTTP method forwards structured failures. Invalid records, unsupported channel kinds, malformed integers and JSON, absent response fields, network rejection, timeout, rate limits, authorization failures, missing guild/channel and unknown status codes have explicit paths. Retry delay prefers a positive finite header over the body, defaults to one second and caps at 3,600 seconds. | Injected `DiscordFetch`; global fetch only when omitted; `AbortSignal.timeout`; logger. Fake responses must cover status codes 401, 403, 404, 429 and 5xx, Discord error codes 10003, 10004, 10007 and 50013, and success/malformed bodies. No HTTP or Discord membership is established here. |
| `discord/DiscordConfig.ts`      | `readDiscordApplication` trims settings, accepts a 5–25 digit application id, rejects missing/blank secrets and internal whitespace, and returns server-only credentials or null. `describeDiscordInstance` reports missing setting names, never secret values. `resolvePublicBaseUrl` uses the origin of configured HTTP(S) URLs, otherwise the request origin; malformed configuration is logged. Empty settings, invalid ids, unsupported protocols, malformed URLs and invalid request origins are distinct paths.                                                                                                                                                                                                                                                                                                                                                                                                | Explicit environment argument; default `process.env`; logger. Use a supplied environment with synthetic strings, never instance credentials.                                                                                                                                                   |
| `discord/DiscordMessage.ts`     | `neutralizeUntrustedText` removes invisible/directional controls, collapses whitespace, shortens source text to 160 UTF-16 code units, breaks mentions/links and escapes markdown. Escaping can lengthen the returned string. `buildNotificationMessage` renders all four event labels and optional reference/status. `buildTestMessage` renders a connection message. Both suppress mentions and link previews. `parseNotificationContent` rejects malformed JSON, null/primitives, unknown events and missing/non-string mandatory facts; optional reference/status become null when absent or non-string.                                                                                                                                                                                                                                                                                                          | Logger; shared event validator. Message formatting alone proves neither delivery nor Discord rendering.                                                                                                                                                                                        |
| `discord/DiscordPermissions.ts` | Installation permissions are View Channel and Send Messages. `computeChannelPermissions` grants the owner/administrator every represented bit; otherwise it combines everyone and owned roles, then everyone overwrite, combined role denies/allows, then the bot member overwrite. Other roles/members are ignored. Missing View Channel removes all effective permissions. `findMissingPermissions` reports either, both or neither required permission in declared order. Empty/unknown roles, conflicting role overwrites, member allow/deny and visibility denial are relevant paths.                                                                                                                                                                                                                                                                                                                            | Shared permission names only. This computes supplied permission facts; it does not establish current Discord authorization or Pages project authorization.                                                                                                                                     |
| `cache/ServerCache.ts`          | Exports group TTLs, `stableIdKey`, a bounded LRU cache and counters. Identifier sorting copies the input. `get` records hit/miss; expiry is a miss. Disabled instances neither retain entries nor increment access/invalidation counters. `set` respects entry and byte quotas. Exact/prefix invalidation removes matching entries, counts actual removals and repeats after an open call commits. Empty prefixes and absent keys are no-ops. Project, listing, membership, work-item, label, assignee, user and GitHub invalidators target their documented key groups. Size calculation handles serializable values, undefined serialization and serialization failure; logging reports an allowlisted key group rather than the full key.                                                                                                                                                                          | `lru-cache` clock/eviction, `keepForCallCommit` registration/callback and logger. Commit registration must be mocked for isolated work; a real database commit or rollback is outside this module.                                                                                             |
| `cache/WorkItemScopeKey.ts`     | `workItemScopeKey` hashes JSON containing actor, departments and projects. Sorting/deduplication makes equivalent scopes stable without modifying inputs. Different actors and different scopes remain distinct. Unrestricted department null differs from an empty list; omitted project scope differs from an empty list. JSON encoding avoids delimiter collisions.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Node SHA-256; no database or network. This distinguishes cache scopes supplied by a caller; it does not decide authorization.                                                                                                                                                                  |
| `concurrency/SerialQueue.ts`    | `run` serializes submitted work, returns each result and exposes its rejection while allowing later work to continue. Both synchronous callback throws and rejected promises flow through the stored rejection handler. `idle` waits for the queue tail observed when called and resolves after failed work as well; work submitted later is not part of that captured tail. Separate queue instances have separate tails.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Promises only. Task execution, cross-process locks, distributed ordering and application transaction correctness are outside the queue.                                                                                                                                                        |

## Coverage state

`scripts/backend-coverage-report.ts` still inventories the entire backend,
including files that a future suite does not import. It writes per-module
statement/branch/function/line tables and preserves missing measurements rather
than converting them to a pass. The existing `pnpm run test:backend` command
propagates runner errors through shell `&&`; the report runs after a successful
runner. Its own errors propagate through its exit-code handler. Reading that
control flow is not an executed failure-injection result.

No measured table was generated in this assignment. Every cell below is
unmeasured, rather than 0%, 100% or not applicable.

| Module                          | Statements | Branches   | Functions  | Lines      |
| ------------------------------- | ---------- | ---------- | ---------- | ---------- |
| `discord/DiscordApiClient.ts`   | unmeasured | unmeasured | unmeasured | unmeasured |
| `discord/DiscordConfig.ts`      | unmeasured | unmeasured | unmeasured | unmeasured |
| `discord/DiscordMessage.ts`     | unmeasured | unmeasured | unmeasured | unmeasured |
| `discord/DiscordPermissions.ts` | unmeasured | unmeasured | unmeasured | unmeasured |
| `cache/ServerCache.ts`          | unmeasured | unmeasured | unmeasured | unmeasured |
| `cache/WorkItemScopeKey.ts`     | unmeasured | unmeasured | unmeasured | unmeasured |
| `concurrency/SerialQueue.ts`    | unmeasured | unmeasured | unmeasured | unmeasured |

The direct source inventory found 1,921 modules: seven in this section and
1,914 in the remaining backend. All remaining areas below are open and outside
the mandatory 100% section. Counts include the syntactically type-only modules;
those 53 modules have no measurable execution and are not applicable when no
instrumentable items exist. The separate declaration file
`backend/database/postgres/pg.d.ts` remains excluded as a declaration.

| Remaining area | Modules | Type-only modules | Behavior status |
| -------------- | ------- | ----------------- | --------------- |
| `agents`       | 215     | 7                 | open            |
| `auth`         | 15      | 0                 | open            |
| `config`       | 11      | 0                 | open            |
| `database`     | 276     | 6                 | open            |
| `error`        | 39      | 0                 | open            |
| `github`       | 7       | 0                 | open            |
| `google`       | 13      | 0                 | open            |
| `logging`      | 17      | 0                 | open            |
| `remote`       | 10      | 0                 | open            |
| `runtime`      | 30      | 0                 | open            |
| `security`     | 6       | 0                 | open            |
| `service`      | 1,255   | 40                | open            |
| `setup`        | 6       | 0                 | open            |
| `storage`      | 14      | 0                 | open            |

This table records the first section at its original base revision. The
`github`, `security` and `setup` areas later became the second mandatory
section with their own 100% per-file threshold and
[inventory](BackendGitHubSecuritySetup.md); the historical row above is not a
current status.

## Cache byte quota correction

The cache previously counted JavaScript string length instead of UTF-8 bytes
after JSON serialization. With a 20-byte quota, `{ text: "€€€€" }` occupied
23 serialized bytes but was counted as 15 characters and retained. The size
calculation now uses `Buffer.byteLength`; the same item is rejected at 20 bytes
and retained at exactly 23 bytes. An ASCII item of 15 bytes still fits a
20-byte quota. Serialization-failure and undefined-result fallbacks retain
their existing estimates.

The quota remains an estimate based on JSON size, not a measurement of the
full JavaScript object's heap usage. The public API, TTLs, counters and
transaction callbacks are unchanged.

## Permitted functional execution

Base revision: `cc9f475571e6b0bcba4c5f5fbb42f893d6ace8fb`. The following direct
invocations ran on 2026-11-16 using Node `24.22.1` and the existing `tsx`
loader; the local commit identifies the final source changes. No test runner,
instrumenter, live service, database or credential was used.

| Actual command and supplied inputs                                                                                                                                                                                                           | Exit code | Observation                                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node --import tsx --input-type=module`, before the correction: import `ServerCache` with Node module hooks substituting logger and transaction registration; set the synthetic euro-text object under a 20-byte quota.                      | 0         | Reproduced the defect: serialized length 15, UTF-8 bytes 23, one retained entry.                                                                                                                                                                                                                                                                                                          |
| `node --import tsx --input-type=module`, after the correction: same mocked boundaries, euro-text object under quotas 20 and 23, ASCII object under quota 20.                                                                                 | 0         | Above-limit retention `false`, at-limit retention `true`, ASCII retention `true`; in-process elapsed time 51 ms.                                                                                                                                                                                                                                                                          |
| `node --import tsx --input-type=module`: import configuration and report module; call `collectBackendCoverageSources(process.cwd())` and `buildBackendCoverageInventory(process.cwd(), {})`; print section counts and configured thresholds. | 0         | Enumerated 1,921 sources, seven mandatory executable modules, 1,914 remaining modules and 53 type-only modules. All seven mandatory entries correctly retained `missing` with null metrics for the deliberately empty metadata input. Each configured metric is 100 with `perFile: true`. In-process elapsed time 985 ms; command wall time 1.746 s. No coverage was measured or written. |

The changed flow was read from UTF-8 sizing into the LRU quota, and from the
per-file configuration through inventory classification, exact-counter
rejection and the existing nonzero command exit path. The preceding foundation
commit and its documented restrictions were reviewed and preserved. These
observations do not establish a full functional suite, actual coverage,
Discord behavior, database transaction integration or production operation.

`pnpm run test:backend`, new test files, failed-test/coverage-threshold runs,
actual artifact readback, suite runtime, lint, TypeScript check, `pnpm run check`,
build and formatting verification: **nicht ausgeführt (Vorgabe Igor)**.
No CI was activated and nothing was published.
