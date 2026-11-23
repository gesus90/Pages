# Backend unit tests

Run the configured backend suite with `pnpm run test:backend`.
`BACKEND_COVERAGE_SECTIONS` in `vitest.backend.config.ts` defines the required
scope for Discord, cache, concurrency, GitHub, security, setup, storage,
Google, config, remote, auth, logging and the top-level backend runtime.
Test discovery includes those sections and the local agent-session directory.
Tests and declaration files are excluded from coverage. Source modules in the
coverage sections are included even when unimported.

Each source module must reach 100% statements, branches, functions and lines.
A metric with no instrumentable items is shown as `n/a`. The report reconciles
measurements with the source inventory and rejects missing executable modules
and incomplete counters. Purely declarative modules are marked not applicable.
It writes JSON reports and section tables to the ignored `coverage/backend/`
directory. The validated `adopted-backend.tsv`
table is printed and included in the backend CI job summary. CI uploads the
coverage directory even if the test command fails.

The [Discord, cache and concurrency inventory](BackendDiscordCacheConcurrency.md)
and [GitHub, security and setup inventory](BackendGitHubSecuritySetup.md) describe
the modules and their external boundaries. The [auth and logging inventory](BackendAuthLogging.md)
does the same for the fourth section. The
[agent catalog, runtime and simulation inventory](BackendAgentCatalogRuntimeSimulation.md)
lists the modules that have no tests and no coverage section yet. The
[agent providers inventory](BackendAgentProviders.md) does the same for
`backend/agents/providers`. The
[agent ACP inventory](BackendAgentAcp.md) does the same for
`backend/agents/acp`, including its `.mjs` modules and unmeasurable code. The
[agent CLI inventory](BackendAgentCli.md) does the same for
`backend/agents/cli`, including the not executable patches. The
[agent base inventory](BackendAgentBase.md) does the same for the files
directly in `backend/agents` and records the patch directories. The
[local agent-session inventory](LocalAgentSessions.md#aktueller-testbestand)
records the local modules and the remaining measurement and operating checks.
The [backend error inventory](BackendError.md) describes the error modules whose
coverage section is pending. Tests use isolated inputs and mock external
services. Live services and instance data are outside their scope.
