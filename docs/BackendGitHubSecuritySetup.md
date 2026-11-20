# GitHub, security and setup

The backend foundation keeps its complete source include, isolated Node
environment, declaration/test-file exclusions and failing empty collection.
Every executable module below `backend/github`, `backend/security` and
`backend/setup` belongs to the second mandatory section. The configuration
requires 100% statements, branches, functions and lines per file on that glob,
including future modules. No previous section or threshold is removed. The
coverage report writes a separate second-section inventory and rejects any
incomplete counter in the first or second section after writing all TSV tables.

The assignment explicitly prohibits creating test files and executing tests,
coverage, lint, typechecks, formatting checks or builds. Those activities are
**nicht ausgeführt (Vorgabe Igor)** and administratively handed to final QA.
There is no unit suite, measured coverage, coverage artifact or successful
backend-test run to claim. The configured threshold does not imply coverage
has been achieved.

## Executable module inventory

All 19 modules contain runtime code; none is declaration-only. The following
cases describe the current implementation and its relevant paths, not executed
unit-test cases.

| Module                                 | Public behavior and relevant paths                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | External boundaries                                                                                                                                                                                        |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `github/GitHubApiClient.ts`            | Maps issue and pull-request records, rejects malformed numbers, states, strings and lists with `GitHubApiError(502)`, filters pull requests from the issue endpoint, follows issue pages while the raw response holds 100 records, and sends method, JSON body and stable GitHub headers. Rejection bodies use a trimmed `message` or fall back to the status text; transport exceptions become `503`. `getRepository` requires `full_name`.                                                                                                               | Injected `GitHubApiRequest`; global fetch only when omitted; logger. Fake responses cover success, invalid bodies, 401/403/404/422/5xx and rejected transport. No HTTP request or real token is used here. |
| `github/GitHubGitAccess.ts`            | Probes the Git receive-pack reference advertisement with Basic credentials and a fixed user agent. Status 200 is `verified`, 401 `rejected`, 403/404 `denied`, and every other status or transport error `unknown`. The optional response body is cancelled without reading it.                                                                                                                                                                                                                                                                            | Injected request; default fetch; 10-second abort; logger. Proves neither a push nor repository content; only GitHub's status answer.                                                                       |
| `github/GitHubRepositoryName.ts`       | Accepts exactly an HTTPS `github.com` address with one owner/name segment and optional `.git` and trailing slash. Rejects other hosts, schemes, credentials, query strings, deeper paths and malformed segments by returning null.                                                                                                                                                                                                                                                                                                                         | String matching only; no network or repository access. Callers must still authorize the repository separately.                                                                                             |
| `github/GitHubRepositoryReadClient.ts` | Issues redirect-free, bounded authenticated GETs. `log` converts `base..head` to GitHub's comparison call or reads commit history, with oldest/newest order and next-page facts. `diff` reports status, ahead/behind, the 300-file limit, truncation and missing patches. `show` combines one commit with a page of files. `file` encodes each path segment, accepts only base64 file records, enforces 128 KiB for both declared and decoded size, and returns UTF-8 text. Responses are capped at 512 KiB; token and credential-shaped text is redacted. | Injected fetch, `AbortSignal.timeout(15000)`, `Response`/stream bodies and GitHub REST JSON. No raw download URL, checkout, redirect or repository write is followed.                                      |
| `github/GitHubSyncScheduler.ts`        | Starts one unref'd interval, keeps at most one round, skips and counts a tick while a round runs, and clears the interval on stop. A stop waits at most 10 seconds and logs a warning on timeout. A round runs as recurring database work inside a logged job; exceptions are logged and produce zero counters.                                                                                                                                                                                                                                            | `setInterval`, injected `GitHubSyncService`, database work context, logger and timing. The service's real synchronization and database availability are outside this module.                               |
| `github/GitHubTokenCrypto.ts`          | AES-256-GCM with a random 12-byte nonce; payload is three base64 segments separated by colons. Decryption requires exactly three segments, a 12-byte nonce, ciphertext and tag; wrong keys, malformed segments and tampering fail.                                                                                                                                                                                                                                                                                                                         | Node crypto only. Key management is separate; plaintext tokens only exist in process memory.                                                                                                               |
| `github/GitHubTokenKey.ts`             | An explicit `PAGES_GITHUB_TOKEN_KEY` must be 64 hexadecimal characters. Otherwise a stored 64-hex key beside the database is read; an absent key is generated once with a random 32-byte value and owner-only file mode. Unreadable files, invalid stored keys, a directory failure and `allowCreate: false` without a key are distinct paths.                                                                                                                                                                                                             | Environment, filesystem beside the configured database, logger. Deployment key management is external; no key leaves the process.                                                                          |
| `security/AgentBrowserSecrets.ts`      | Redacts issued `pabs_` tokens, their base64 cookie prefix and private `pages-agent-browser-` paths with the literal replacement. Detection is defined as a changed redacted text. Ordinary text stays unchanged.                                                                                                                                                                                                                                                                                                                                           | String processing only. It detects the documented shapes, not arbitrary secrets or every path spelling.                                                                                                    |
| `security/AgentCredential.ts`          | Creates 32 random bytes as a 43-character base64url credential and persists only its SHA-256 hex digest. Repeated calls produce different credentials; hashing is deterministic.                                                                                                                                                                                                                                                                                                                                                                           | Node crypto only. The caller must deliver the clear credential once and never log it.                                                                                                                      |
| `security/AgentTextSafety.ts`          | Applies browser-secret redaction, then masks API-key-like values, Google keys, bearer values, key/token/password assignments and JWT-shaped strings. Credential-free input passes unchanged; any detected shape raises `AgentExecutionError("credentialsInText")`.                                                                                                                                                                                                                                                                                         | Shared error type and browser redactor. Shape detection is heuristic; it does not prove that no unknown secret exists.                                                                                     |
| `security/IdentityText.ts`             | Reports whether a name or credential contains U+0000 so it can be refused before a database comparison. Other text is unchanged.                                                                                                                                                                                                                                                                                                                                                                                                                           | String processing only. It does not decide identity, authorization or normalization.                                                                                                                       |
| `security/InstanceSecretCipher.ts`     | Derives a 32-byte key with HKDF-SHA-256 from the instance key, encrypts with AES-256-GCM and a fresh nonce, and binds the payload to `agent-connection:<connectionId>` as AAD. The versioned payload carries nonce, ciphertext and 16-byte tag. Unknown versions, relocation, malformed payloads and tampering fail as `secret_unavailable`.                                                                                                                                                                                                               | Node crypto and logger. The instance key itself is supplied by the caller and is not stored in this module.                                                                                                |
| `security/McpDeviceCredential.ts`      | Draws eight unbiased user-code characters from the declared alphabet, accepts only 43 base64url characters as a device secret/token, hashes with purpose-separated SHA-256 and compares stored hashes in constant time after a length check.                                                                                                                                                                                                                                                                                                               | Node crypto and shared MCP constants. It does not create, store or revoke device records.                                                                                                                  |
| `setup/SetupConnection.ts`             | Validates length, NUL, URL syntax, decodable password and the `postgres:`/`postgresql:` schemes without logging the URL. An empty input reports `EMPTY`; invalid input `INVALID`. Otherwise it registers the URL and decoded password as log secrets, connects for up to five seconds, checks public tables, routines and user-defined types/enums/ranges, and reports `AVAILABLE`, `FOREIGN` or `NOT_WRITABLE`.                                                                                                                                           | Dynamic `pg` client; injected PostgreSQL network; log redaction and shared status constants. Requires a reachable database for the connectivity branches.                                                  |
| `setup/SetupDatabaseWriter.ts`         | Writes a setup into an already migrated database. An existing administrator is updated (password, given email, active state, role and authorizations), older sessions are revoked and a new session is created. An existing non-administrator returns `usernameTaken`; an email owned by another account returns `emailTaken`. Company settings and administrator language are saved; a new account is created otherwise.                                                                                                                                  | Repository, session, authorization and settings services over one database. Not transactional as a whole; repeated writes are documented as converging to the same state.                                  |
| `setup/SetupIntent.ts`                 | Creates a private 0600 recovery file with a random 43-character token, database URL and HMAC-SHA-256 fingerprint over the submitted values. Reading uses `O_NOFOLLOW`, requires a regular file owned by this user with no group/other bits and at most 16 KiB, and validates all fields. Creation is exclusive and synced with the directory; retirement unlinks and syncs, and matching retirement ignores a different database.                                                                                                                          | Filesystem, random/HMAC crypto, logger. It intentionally refuses an existing intent instead of overwriting another attempt.                                                                                |
| `setup/SetupPostgresRepository.ts`     | Opens a serializable transaction, sets the public search path, takes a transaction advisory lock, and refuses any public table, routine or user-defined type/enum/range. It creates the migration table, applies names in order and records checksums, then inserts the administrator, account provisioning, company settings, language and session. `hasCommittedSetup` requires exactly one session for the token; renewal updates only that session.                                                                                                    | `Database`/`DatabaseTransaction`, migration checksum, account provisioning, repository role constants and PostgreSQL SQL. A live database is required for the transaction branches.                        |
| `setup/SetupService.ts`                | Migrates only the untouched bootstrap `admin`/`Admin` with the administrator role and an unsupported password hash. It replaces the hash with the known bootstrap password and returns true; a missing user, changed display name, another role or an already supported hash is left untouched.                                                                                                                                                                                                                                                            | Injected user repository and password hasher. It does not authenticate, seed or reset any other account.                                                                                                   |
| `setup/SetupWizardService.ts`          | Serializes completion through `runExclusiveSetup`, returns `alreadyCompleted` when setup is no longer pending, rejects a wrong token, and reports an invalid database URL before connecting. It reuses or creates the private intent, checks whether the token was committed, renews or initializes, stores the database configuration, activates services, finishes setup and retires the intent. A non-empty database becomes `FOREIGN`; other failures become `failed` while restoring the previous configuration.                                      | Runtime config/token/setup lifecycle, `Database.connect`, migrations, password hasher and service activation. The success path needs a real or fully faked database/runtime boundary.                      |

## Coverage state

`scripts/backend-coverage-report.ts` inventories the complete backend,
including files a future suite does not import. It writes per-module
statement/branch/function/line tables for the first, second and remaining
backend sections, preserves missing measurements and rejects any incomplete
entry outside the remaining backend. `pnpm run test:backend` still propagates
runner and report failures through `&&` and its exit-code handler.

No measured table was generated in this assignment. Every cell below is
unmeasured, rather than 0%, 100% or not applicable.

| Module                                 | Statements | Branches   | Functions  | Lines      |
| -------------------------------------- | ---------- | ---------- | ---------- | ---------- |
| `github/GitHubApiClient.ts`            | unmeasured | unmeasured | unmeasured | unmeasured |
| `github/GitHubGitAccess.ts`            | unmeasured | unmeasured | unmeasured | unmeasured |
| `github/GitHubRepositoryName.ts`       | unmeasured | unmeasured | unmeasured | unmeasured |
| `github/GitHubRepositoryReadClient.ts` | unmeasured | unmeasured | unmeasured | unmeasured |
| `github/GitHubSyncScheduler.ts`        | unmeasured | unmeasured | unmeasured | unmeasured |
| `github/GitHubTokenCrypto.ts`          | unmeasured | unmeasured | unmeasured | unmeasured |
| `github/GitHubTokenKey.ts`             | unmeasured | unmeasured | unmeasured | unmeasured |
| `security/AgentBrowserSecrets.ts`      | unmeasured | unmeasured | unmeasured | unmeasured |
| `security/AgentCredential.ts`          | unmeasured | unmeasured | unmeasured | unmeasured |
| `security/AgentTextSafety.ts`          | unmeasured | unmeasured | unmeasured | unmeasured |
| `security/IdentityText.ts`             | unmeasured | unmeasured | unmeasured | unmeasured |
| `security/InstanceSecretCipher.ts`     | unmeasured | unmeasured | unmeasured | unmeasured |
| `security/McpDeviceCredential.ts`      | unmeasured | unmeasured | unmeasured | unmeasured |
| `setup/SetupConnection.ts`             | unmeasured | unmeasured | unmeasured | unmeasured |
| `setup/SetupDatabaseWriter.ts`         | unmeasured | unmeasured | unmeasured | unmeasured |
| `setup/SetupIntent.ts`                 | unmeasured | unmeasured | unmeasured | unmeasured |
| `setup/SetupPostgresRepository.ts`     | unmeasured | unmeasured | unmeasured | unmeasured |
| `setup/SetupService.ts`                | unmeasured | unmeasured | unmeasured | unmeasured |
| `setup/SetupWizardService.ts`          | unmeasured | unmeasured | unmeasured | unmeasured |

The current direct source inventory finds 1,930 modules: seven in the first
section, 19 in this second section and 1,904 in the remaining backend. None of
the 19 second-section modules is syntactically type-only. The remaining
backend contains 54 type-only modules, which stay listed as not applicable
when no instrumentable items exist. The separate declaration file
`backend/database/postgres/pg.d.ts` remains excluded. These are source counts,
not measured coverage results.

## Remaining backend areas

All areas below are open and outside both mandatory sections. They are outside the normal backend test and coverage scope and have no percentage gate yet.

| Remaining area | Modules | Type-only modules | Behavior status |
| -------------- | ------- | ----------------- | --------------- |
| `agents`       | 215     | 7                 | open            |
| `auth`         | 15      | 0                 | open            |
| `config`       | 11      | 0                 | open            |
| `database`     | 280     | 6                 | open            |
| `error`        | 39      | 0                 | open            |
| `google`       | 13      | 0                 | open            |
| `logging`      | 17      | 0                 | open            |
| `remote`       | 10      | 0                 | open            |
| `runtime`      | 30      | 0                 | open            |
| `service`      | 1,260   | 41                | open            |
| `storage`      | 14      | 0                 | open            |

## Permitted functional execution

The following direct invocations ran on 2026-11-16 with Node `24.22.1`, the
existing `tsx` loader and synthetic values. No test runner, instrumenter, live
service, database, credential, browser or application server was used.

| Actual command and supplied inputs                                                                                                                                                                                                                                                                            | Exit code | Observation                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node --import tsx /tmp/opencode/page457/probe.mts` with temporary assertions for repository-name parsing, token crypto/key, API mapping, write-access statuses, repository reads, scheduler lifecycle/skip, security helpers, setup URL/intent/service and PostgreSQL setup SQL with a supplied transaction. | 0         | All groups reported `ok` and the process ended with `all probes passed`. Covered successful and failing branches, including wrong keys/AAD, tampering, malformed payloads, invalid URLs, invalid credentials, 401/403/404/422/503, oversized files, missing patches, a skipped scheduler tick and a non-empty setup database. Synthetic inputs only; the logger emitted local events. |
| `node --import tsx --input-type=module`: import the configuration and report module; call `collectBackendCoverageSources(process.cwd())` and `buildBackendCoverageInventory(process.cwd(), {})`; print section counts and configured thresholds.                                                              | 0         | Enumerated 1,930 sources, seven first-section modules, 19 second-section modules, 1,904 remaining modules and 54 type-only modules. All second-section entries retained `missing` with null metrics for the deliberately empty metadata input. Each configured metric is 100 with `perFile: true`. No coverage was measured or written.                                               |

`SetupWizardService` could not be imported by the direct probe because
`backend/database/Migrations.ts` uses Vite's `import.meta.glob`; its early
guards and completion flow were read, not executed. `SetupDatabaseWriter` was
read only: its repository SQL needs a migrated database, which this assignment
does not start. `SetupConnection.checkSetupConnection` was exercised only for
`EMPTY` and `INVALID`; connectivity and public-schema classification need a
PostgreSQL server. `GitHubSyncScheduler`'s database context and logger were
wrapped by the real modules, not a live database. These observations do not
establish a full functional suite, actual coverage, GitHub behavior, PostgreSQL
transaction integration or production operation.

`pnpm run test:backend`, new test files, failed-test/coverage-threshold runs,
actual artifact readback, suite runtime, lint, TypeScript check, `pnpm run check`,
build and formatting verification: **nicht ausgeführt (Vorgabe Igor)**.
No CI was activated, nothing was published and no branch was changed.
