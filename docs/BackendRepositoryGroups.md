# Remaining repository groups

This inventory covers the 77 repository modules in `backend/database/repositories/`
that no earlier repository group selects: the employee repositories, the calendar
and event repositories, the mobile, remote, integration, Discord and MCP
repositories, the search, diagnosis, storage, Google and speech repositories, and
the repositories directly in `repositories/` that remain. It was taken from the
source tree of revision `3d381c25` and records what exists; it makes no claim
about test or coverage results.

## How the groups were cut

The repository tree holds 274 TypeScript modules apart from test files. Earlier
groups already claim 197 of them by explicit boundary:

| Earlier group               | Boundary                                                                                       | Modules |
| --------------------------- | ---------------------------------------------------------------------------------------------- | ------- |
| Projects, tickets and wiki  | `project/`, `task/`, `wiki/`, `ProjectRepository.ts`, `TaskRepository.ts`, `WikiRepository.ts` | 66      |
| Chats and conversations     | `chat/`, `conversation/`, `LiveChangeNotificationRepository.ts`                                | 34      |
| Agents, sessions and quotas | `agents/`, `AgentConnectionRepository.ts`, `agent/` files not named `AgentPlan…` or `Plan…`    | 41      |
| Plan definitions and rights | 13 named `AgentPlan…` and `PlanBridgeGrantRepository` modules in `agent/`                      | 13      |
| Plan runs and runners       | `runner/`, remaining `AgentPlan…` and `Plan…` modules in `agent/`                              | 38      |
| Automations                 | `automation/`                                                                                  | 5       |

The 77 modules that remain are split into five groups by what they store. Each
module belongs to exactly one group, and every directory under `repositories/`
belongs to exactly one group of the whole tree. No module is claimed twice, no
file name repeats within the tree, and no module is left unassigned.

| Group                           | Location under `backend/database/repositories/`                              | Modules |
| ------------------------------- | ---------------------------------------------------------------------------- | ------- |
| Employees                       | `employee/`                                                                  | 24      |
| Calendar and events             | `calendar/`, `events/`                                                       | 7       |
| Mobile, remote and integrations | `mobile/`, `remote/`, `integrations/`, `discord/`, `mcp/`                    | 18      |
| Search, diagnosis and storage   | `search/`, `diagnosis/`, `storage/`, `google/`, `speech/`                    | 14      |
| Remaining repositories          | the 14 files directly in `repositories/` that no earlier group names (below) | 14      |

Total: 24 + 7 + 18 + 14 + 14 = 77.

## Test files

No test file exists in any of these directories, and no test file selects these
modules. Seven test files outside `backend/database/` import some of them
(`auth/AuthService`, `auth/SessionService`, `runtime/IntegrationsEntry`,
`service/agents/AgentPlanScriptPreparation`, `setup/SetupDatabaseWriter`,
`setup/SetupPostgresRepository`, `setup/SetupService`). They test the modules of
their own sections and use the repositories only as a dependency, so they are not
duplicates and stay with their sections. The two test files that exist below
`repositories/` (`agent/AgentPlanRestartRetirement.test.ts`,
`runner/RunnerRepositoryArchive.test.ts`) belong to the plan run and runner group.

## Measurability

- 76 of the 77 modules declare a class or exported function and are measurable.
- `discord/DiscordDatabase.ts` holds one `Pick<Database, …>` type alias and no
  runtime statement. It has no instrumentable item and is reported as `n/a`, not
  as a gap.
- `calendar/CalendarSql.ts` (18 lines), `integrations/IntegrationOwnerRepository.ts`
  (19 lines), `LegacyAccountProvisioning.ts` and `StoredTextForm.ts` are small
  but executable.
- Three modules are longer than 600 lines: `GitHubRepository.ts` (659 lines),
  `UserRepository.ts` (767 lines) and `employee/AgentLogbookRepository.ts`
  (620 lines). Their tests will not fit into one test file within the 600-line
  limit; split the suites by method group across several files.

## Boundary a test controls

Repositories take the `Database` (`query`, `execute`, `transaction`) or an open
`DatabaseTransaction` through the constructor or as an argument. A test replaces
that executor with a double that records the SQL text and parameters and returns
prepared rows, so no PostgreSQL instance is needed. SQL that only a real database
can verify belongs to the PostgreSQL integration suite (`docs/PostgresIntegration.md`).

## Modules

### Employees (24)

`employee/`: `AccountIdentityRepository`, `AgentActivityRepository`,
`AgentChatMemoryRepository`, `AgentChatModelRepository`,
`AgentChatSessionRepository`, `AgentConversationRepository`,
`AgentDeletionPurgeRepository`, `AgentDeletionRepository`,
`AgentDreamingRepository`, `AgentEmployeeRemovalRepository`,
`AgentEmployeeRepository`, `AgentLearningSourceRepository`,
`AgentLogbookRepository`, `AgentLogbookSessionRepository`,
`AgentMemoryRepository`, `AgentProfileLoadRepository`, `AgentRecipeRepository`,
`AgentSessionSettingsRepository`, `AgentTemplateRepository`,
`AgentToolUseRepository`, `ChatContactRepository`, `ChatGroupRepository`,
`ChatSessionControllerRepository`, `EmployeeStore`.

### Calendar and events (7)

- `calendar/`: `CalendarDirectoryRepository`, `CalendarEventRepository`,
  `CalendarParticipationRepository`, `CalendarSourceRepository`, `CalendarSql`.
- `events/`: `PagesEventOutboxReaderRepository`, `PagesEventOutboxRepository`.

### Mobile, remote and integrations (18)

- `mobile/`: `PicaMobileNotificationDeliveryRepository`,
  `PicaMobileNotificationEventRepository`,
  `PicaMobileNotificationPreferenceRepository`,
  `PicaMobilePushRegistrationRepository`.
- `remote/`: `RemoteConnectionRepository`, `RemoteConsoleSessionRepository`,
  `RemoteInstallFindingRepository`, `RemoteWorkspaceRepository`.
- `integrations/`: `GitHubCreationRepository`, `GitHubJobRepository`,
  `IntegrationOwnerRepository`.
- `discord/`: `DiscordAttemptRepository`, `DiscordConnectionRepository`,
  `DiscordDatabase` (type only), `DiscordDeliveryRepository`.
- `mcp/`: `AgentRunCredentialRepository`, `McpDevicePairingRepository`,
  `McpDeviceRepository`.

### Search, diagnosis and storage (14)

- `search/`: `SearchEmbeddingRepository`, `SearchSourceRepository`,
  `SourceSearchRepository`.
- `diagnosis/`: `AgentRunActivityRepository`,
  `AgentRunDiagnosisSettingsRepository`, `AgentRunFailureRepository`,
  `AgentRunLogRepository`.
- `storage/`: `StorageMaintenanceRepository`.
- `google/`: `GoogleDriveRepository`, `StorageAccessRepository`,
  `StorageOperationRepository`, `StorageStartFolderRepository`.
- `speech/`: `SpeechSettingsRepository`, `SpeechSynthesisSettingsRepository`.

### Remaining repositories (14)

Directly in `repositories/`: `AdministrationActivityRepository`,
`AuthorizationRepository`, `GitHubRepository`, `InstanceSettingsRepository`,
`LegacyAccountProvisioning`, `ManagementAuditRepository`,
`ManagementRepository`, `SessionRepository`, `StoredTextForm`,
`SystemMetricsRepository`, `UserBoardPreferencesRepository`,
`UserGroupRepository`, `UserRepository`, `UserSettingsRepository`.

## Not yet selected

None of these groups is selected by `BACKEND_COVERAGE_SECTIONS` in
`vitest.backend.config.ts`. A section needs its test files first: without them
the per-file coverage report would reject every module as missing a measurement.
Add each section together with its tests.
