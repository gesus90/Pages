# Backend unit tests

Run the configured backend suite with `pnpm run test:backend`.
`BACKEND_COVERAGE_SECTIONS` in `vitest.backend.config.ts` defines the required
scope. Test discovery uses the same section boundaries for `*.test.ts` and
`*.spec.ts`.

| Section                               | Directories under `backend/`                               |
| ------------------------------------- | ---------------------------------------------------------- |
| Discord, cache and concurrency        | `discord/`, `cache/`, `concurrency/`                       |
| GitHub, security and setup            | `github/`, `security/`, `setup/`                           |
| Storage, Google, config and remote    | `storage/`, `google/`, `config/`, `remote/`                |
| Auth and logging                      | `auth/`, `logging/`                                        |
| Backend runtime                       | `runtime/`                                                 |
| Errors                                | `error/`                                                   |
| Agent catalog, runtime and simulation | `agents/catalog/`, `agents/runtime/`, `agents/simulation/` |
| Agent providers                       | `agents/providers/`                                        |
| Local agent sessions                  | `agents/local/`                                            |
| Agent ACP                             | `agents/acp/`                                              |
| Agent CLI                             | `agents/cli/`                                              |
| Agent base                            | Files directly in `agents/`                                |

Coverage includes unimported source modules and excludes test and TypeScript
declaration files.

Each source module must reach 100% statements, branches, functions and lines.
A metric with no instrumentable items is shown as `n/a`. The report reconciles
measurements with the source inventory and rejects missing executable modules
and incomplete counters. The source inventory records why a module with only
type declarations or named re-exports has no implementation to measure.
The ignored `coverage/backend/` directory contains the raw Vitest results,
the per-section test counts (`section-tests.tsv` and `section-tests.json`),
the raw coverage reports, and the per-file coverage inventories. Test counts
include collected cases that passed, failed, or did not run. The backend CI job
summary includes `section-tests.tsv` and `adopted-backend.tsv` when present.
CI uploads the report directory even if the test command fails.

The [Discord, cache and concurrency inventory](BackendDiscordCacheConcurrency.md)
and [GitHub, security and setup inventory](BackendGitHubSecuritySetup.md) describe
the modules and their external boundaries. The [auth and logging inventory](BackendAuthLogging.md)
does the same for the fourth section. The
[agent catalog, runtime and simulation inventory](BackendAgentCatalogRuntimeSimulation.md)
and the inventories for [agent providers](BackendAgentProviders.md),
[agent ACP](BackendAgentAcp.md), [agent CLI](BackendAgentCli.md) and the
[agent base modules](BackendAgentBase.md) describe the source and its external
boundaries. The
[local agent-session inventory](LocalAgentSessions.md#aktueller-testbestand)
records the local modules and the remaining measurement and operating checks.
The [backend error inventory](BackendError.md) describes the error modules.
The [agent plan repository inventory](BackendAgentPlanRepositories.md) records the
plan definition and access repositories that no section selects yet.
The [agent plan run and runner repository inventory](BackendAgentPlanRunRepositories.md)
records the run, checkpoint, recovery, lock and runner repositories that no
section selects yet.
The [automation repository inventory](BackendAutomationRepositories.md)
records the automation, run, event, agent delivery and notification repositories
that no section selects yet.
The [remaining repository inventory](BackendRepositoryGroups.md) assigns the
77 employee, calendar, event, mobile, remote, integration, Discord, MCP, search,
diagnosis, storage, Google, speech and root repository modules to five groups
that no section selects yet.
Tests use isolated inputs and mock external services. Live services and
instance data are outside their scope.
