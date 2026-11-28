# Backend unit tests

Run the configured backend suite with `pnpm run test:backend`.
`BACKEND_COVERAGE_SECTIONS` in `vitest.backend.config.ts` defines the required
scope. Test discovery uses the same section boundaries for `*.test.ts` and
`*.spec.ts`.

| Section                               | Directories under `backend/`                                                                                                                                                                                                                                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Discord, cache and concurrency        | `discord/`, `cache/`, `concurrency/`                                                                                                                                                                                                                                                                          |
| GitHub, security and setup            | `github/`, `security/`, `setup/`                                                                                                                                                                                                                                                                              |
| Storage, Google, config and remote    | `storage/`, `google/`, `config/`, `remote/`                                                                                                                                                                                                                                                                   |
| Auth and logging                      | `auth/`, `logging/`                                                                                                                                                                                                                                                                                           |
| Backend runtime                       | `runtime/`                                                                                                                                                                                                                                                                                                    |
| Errors                                | `error/`                                                                                                                                                                                                                                                                                                      |
| Agent catalog, runtime and simulation | `agents/catalog/`, `agents/runtime/`, `agents/simulation/`                                                                                                                                                                                                                                                    |
| Agent providers                       | `agents/providers/`                                                                                                                                                                                                                                                                                           |
| Local agent sessions                  | `agents/local/`                                                                                                                                                                                                                                                                                               |
| Agent ACP                             | `agents/acp/`                                                                                                                                                                                                                                                                                                 |
| Agent CLI                             | `agents/cli/`                                                                                                                                                                                                                                                                                                 |
| Agent base                            | Files directly in `agents/`                                                                                                                                                                                                                                                                                   |
| Database core, executor, PostgreSQL   | `database/` files, `database/{executor,postgres}/`                                                                                                                                                                                                                                                            |
| Database project, task, wiki repos    | `database/repositories/{project,task,wiki}/` and root files                                                                                                                                                                                                                                                   |
| Database chat, conversation repos     | `database/repositories/{chat,conversation}/`, `LiveChangeNotificationRepository.ts`                                                                                                                                                                                                                           |
| Database agent repositories           | `database/repositories/agents/`, `AgentConnectionRepository.ts`, `agent/` without the `AgentPlan` and `Plan` prefixes                                                                                                                                                                                         |
| Database agent plan repositories      | `database/repositories/agent/`: `AgentPlan{AccessRepository,AuditRepository,ChangeNotification,DeletionGuard,OneShotRepository,RemoteAccessRepository,Repository,ScriptApprovalRepository,StoredReferences,TeamRepository,TemplateRepository,WorkspaceRepository}` and `PlanBridgeGrantRepository`            |
| Database integration repositories     | `database/repositories/{mobile,remote,integrations,discord,google,mcp,speech}/`, `GitHubRepository.ts`                                                                                                                                                                                                        |
| Database search, diagnosis, storage   | `database/repositories/{search,diagnosis,storage}/`, `StoredTextForm.ts`, `SystemMetricsRepository.ts`                                                                                                                                                                                                        |
| Database remaining repositories       | `database/repositories/` root: `AdministrationActivityRepository.ts`, `AuthorizationRepository.ts`, `InstanceSettingsRepository.ts`, `LegacyAccountProvisioning.ts`, `ManagementAuditRepository.ts`, `ManagementRepository.ts`, `SessionRepository.ts`, `User{,BoardPreferences,Group,Settings}Repository.ts` |

## Registered packages without required coverage

`BACKEND_REGISTERED_PACKAGES` in `vitest.backend.config.ts` registers further
service packages. Their `*.test.ts` and `*.spec.ts` files run with
`pnpm run test:backend` and appear in the per-section test counts. Their source
modules are not measured and have no threshold until a package moves into
`BACKEND_COVERAGE_SECTIONS`. A package without test files shows zero files.

| Package                                         | Selection under `backend/service/`                                                                        |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `service-chat`                                  | `chat/`                                                                                                   |
| `service-conversation`                          | `conversation/`                                                                                           |
| `service-employee`                              | `employee/`                                                                                               |
| `service-mcp`                                   | `mcp/`                                                                                                    |
| `service-mobile`                                | `mobile/`                                                                                                 |
| `service-runner`                                | `runner/`                                                                                                 |
| `service-design`                                | `design/`                                                                                                 |
| `service-speech`                                | `speech/`                                                                                                 |
| `service-root-before-m`                         | Files directly in `backend/service/` whose names sort before `M`                                          |
| `service-root-from-m-and-remaining-directories` | Files directly in `backend/service/` from `M` on, and every subdirectory not listed above or in `agents/` |
| `service-agent-assets-branching-bridge`         | `agents/{assets,branching,bridge}/`                                                                       |
| `service-agent-diagnosis-invocation`            | `agents/{diagnosis,invocation}/`                                                                          |
| `service-agent-loop-recovery`                   | `agents/{loop,recovery}/`                                                                                 |
| `service-agent-resources`                       | `agents/resources/`                                                                                       |
| `service-agent-runs`                            | `agents/runs/`                                                                                            |
| `service-agent-sessions`                        | `agents/sessions/`                                                                                        |
| `service-agent-stack-swarm`                     | `agents/{stack,swarm}/`                                                                                   |
| `service-agent-tools-usage`                     | `agents/{tools,usage}/`                                                                                   |

Files directly in `backend/service/agents/` and any other subdirectories
belong to the remaining inventory.

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
The [service groups inventory](BackendServiceGroups.md) assigns 186 wiki, task,
project, calendar, event, automation, GitHub, Google, Discord, remote,
integration, management, system, interpreter and search service modules to
eight disjoint groups that no section selects yet, and records the remaining
service areas separately.
Tests use isolated inputs and mock external services. Live services and
instance data are outside their scope.
