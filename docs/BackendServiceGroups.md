# Backend service groups

This inventory covers 186 TypeScript modules in `backend/service/` organized
into eight disjoint service groups: wiki; tasks; projects; calendar and events;
automations; GitHub, Google and Discord; remote and integrations; and
management, system, interpreters and search. It was taken from the source tree
of revision `4a6e0e14`, reconciled against reference revision `3d381c25`, and
records what exists; it makes no claim about test or coverage results.

## Reconciliation against adopted sections and reference revision

At revision `4a6e0e14`, the 24 sections in `BACKEND_COVERAGE_SECTIONS`
(`vitest.backend.config.ts`) select all 705 non-service backend source modules
and zero modules under `backend/service/`. None of the eight service groups
overlaps with any adopted section or with any other service group.

Across the entire `backend/service/` tree, revision `4a6e0e14` holds 1,377
tracked files: 1,352 TypeScript source modules, 16 existing test files and 9
Markdown files. Compared with reference revision `3d381c25` (1,374 tracked
files):

- Zero files were added, removed or modified inside the eight service groups
  listed below.
- Three TypeScript source modules were added in remaining service areas outside
  these eight groups: `agents/ZaiCodingPlanQuotaProbe.ts`,
  `agents/ZaiCodingPlanQuotaService.ts` and
  `conversation/ConversationResumeContext.ts`.
- Twenty-one files in remaining service areas (`agents/`, `chat/`,
  `conversation/` and `employee/`) were modified.

## How the eight groups are cut

Each module belongs to exactly one group by directory prefix under
`backend/service/`. No module is claimed twice, and no non-TypeScript or test
file exists inside these directories.

| Group                                       | Location under `backend/service/`                    | Modules | Executable | Type-only | Tests |
| ------------------------------------------- | ---------------------------------------------------- | ------- | ---------- | --------- | ----- |
| Wiki                                        | `wiki/`                                              | 26      | 26         | 0         | 0     |
| Tasks                                       | `task/`                                              | 29      | 29         | 0         | 0     |
| Projects                                    | `project/`                                           | 8       | 8          | 0         | 0     |
| Calendar and events                         | `calendar/`, `events/`                               | 17      | 17         | 0         | 0     |
| Automations                                 | `automation/`                                        | 18      | 17         | 1         | 0     |
| GitHub, Google and Discord                  | `github/`, `google/`, `discord/`                     | 38      | 37         | 1         | 0     |
| Remote and integrations                     | `remote/`, `integrations/`                           | 25      | 24         | 1         | 0     |
| Management, system, interpreters and search | `management/`, `system/`, `interpreters/`, `search/` | 25      | 24         | 1         | 0     |

Total: 26 + 29 + 8 + 17 + 18 + 38 + 25 + 25 = 186 modules (182 executable, 4
type-only).

## Test files

No test file exists in any of these eight group directories, and no section in
`vitest.backend.config.ts` selects them yet. Two test files outside
`backend/service/` import modules from these directories as dependencies:

- `backend/agents/cli/CliAssetWorkspace.test.ts` imports `wiki/WikiFileTypes`.
- `backend/runtime/IntegrationsEntry.test.ts` imports
  `events/LiveChangeRelay`, `events/PagesEventPublisher`,
  `integrations/GitHubJobWorker`, `integrations/IntegrationFcmConsumer`,
  `integrations/IntegrationProcessing`, `integrations/IntegrationRunAccess` and
  `integrations/IntegrationServices`.

Both files belong to their own adopted sections (`agent-cli` and
`fifth-section`) and are not duplicates of unit tests for these service groups.

## Measurability

- 182 of the 186 modules contain executable runtime code and are measurable.
- Four modules consist exclusively of TypeScript type and interface
  declarations, have no instrumentable items, and are reported as `n/a`
  (`Type declarations only`), not as coverage gaps:
  - `automation/AutomationDirectory.ts`
  - `google/StorageFileRequests.ts`
  - `remote/RemoteConsoleConductor.ts`
  - `management/ManagementContext.ts`
- No module in these eight groups consists only of named re-exports or empty
  class declarations.
- Six modules exceed 600 lines: `wiki/WikiPageService.ts` (659 lines),
  `task/TaskWriteService.ts` (742 lines),
  `google/GoogleDriveConnectionService.ts` (750 lines),
  `google/StorageFileReader.ts` (605 lines),
  `google/StorageFileWriter.ts` (702 lines) and
  `search/HybridSearchService.ts` (611 lines). Their suites should be split by
  method group across several test files to stay within the 600-line file limit.

## External boundaries a test controls

Unit tests mock external systems and persistence boundaries instead of starting
live services or connecting to a real PostgreSQL instance:

- **Wiki, tasks and projects**: repositories, `CallTransaction` / `Database`,
  permission/policy services, `ServerCache`, `SerialQueue`, `WikiFileStore`,
  `TicketFileStore`, filesystem calls (`node:fs`, `node:fs/promises`),
  `node:crypto`, and outbound publishers (`GitHubSyncService`, event hub).
- **Calendar and events**: repositories, `Database` / transactions, permission
  and settings services, `node:crypto`, timers and listener callbacks.
- **Automations**: repositories, `Database`, `AutomationDirectory`, agent/plan
  and mobile dispatch boundaries, and child processes (`node:child_process`,
  `node:stream`) in `AutomationScriptProcess`.
- **GitHub, Google and Discord**: repositories, HTTP API clients
  (`GitHubApiClient`, `GitHubRepositoryReadClient`, `GoogleDriveApiClient`,
  `GoogleDriveFilesClient`, `GoogleDriveItemsClient`, `DiscordApiClient`),
  token/secret ciphers, timers/backoff clocks and event publishers.
- **Remote and integrations**: repositories, `SshClient`, `SshHostKey`, `SshPty`,
  `RemoteSession` / `RemoteSessionRegistry`, `node:net`, `node:timers/promises`,
  secret cipher, GitHub/FCM integration clients and health reporters.
- **Management, system, interpreters and search**: repositories, `Database`,
  password hasher, `ServerCache`, `@napi-rs/canvas` avatar rendering,
  `SendmailInvitationDelivery`, child processes (`node:child_process`,
  `node:fs/promises`, `node:stream/consumers`), filesystem/system probes and
  embedding/index providers.

Real PostgreSQL queries and schema migrations remain separate in the PostgreSQL
integration suite (`docs/PostgresIntegration.md`).

## Modules in the eight groups

### Wiki (26)

`wiki/`: `AnnouncingWikiService`, `WikiAccess`, `WikiActivity`,
`WikiAnchorValidator`, `WikiAttachmentService`, `WikiChoiceService`,
`WikiCommentService`, `WikiCoverService`, `WikiFeedService`, `WikiFileTypes`,
`WikiLinks`, `WikiMaintenanceScheduler`, `WikiMaintenanceService`,
`WikiMentions`, `WikiMoveService`, `WikiPageReader`, `WikiPageService`,
`WikiPlacementResolver`, `WikiPlainText`, `WikiReadService`,
`WikiSearchQuery`, `WikiSearchService`, `WikiSettingsService`,
`WikiTrashService`, `WikiValidation`, `WikiVersionService`.

### Tasks (29)

`task/`: `ProjectKey`, `TaskAccessGuard`, `TaskAssigneeGroupService`,
`TaskAttachmentService`, `TaskChecklistService`, `TaskDepartmentService`,
`TaskDescriptionAssetService`, `TaskFieldService`, `TaskGitHubPublisher`,
`TaskHistoryRecorder`, `TaskHistoryVisibility`, `TaskLabelService`,
`TaskLifecycleService`, `TaskLinkService`, `TaskMilestoneLinkService`,
`TaskMilestoneService`, `TaskMoveService`, `TaskReadService`,
`TaskStoredText`, `TaskWriteService`, `TicketAssetAuditService`,
`TicketAssetMigrationService`, `TicketChecklist`,
`TicketDescriptionReferences`, `TicketTreeService`, `WorkItemHierarchy`,
`WorkItemNumbering`, `WorkItemReferenceValidator`, `WorkItemValidation`.

### Projects (8)

`project/`: `ProjectAccessService`, `ProjectCreationService`,
`ProjectDeletionService`, `ProjectDeletionStorage`, `ProjectEventValues`,
`ProjectGoalService`, `ProjectManagementService`, `ProjectTemplateService`.

### Calendar and events (17)

- `calendar/` (11): `CalendarEventInput`, `CalendarOccurrences`,
  `CalendarPeople`, `CalendarProjection`, `CalendarReader`,
  `CalendarRecurrence`, `CalendarSeriesChanges`, `CalendarService`,
  `CalendarTime`, `CalendarViewer`, `CalendarWriter`.
- `events/` (6): `LiveChangeAudience`, `LiveChangeDecisions`, `LiveChangeHub`,
  `LiveChangeRelay`, `PagesEventPublisher`, `PagesEventRetention`.

### Automations (18)

`automation/`: `AutomationAccess`, `AutomationAgentWorker`,
`AutomationDirectory` (type only), `AutomationEventData`,
`AutomationEventIntake`, `AutomationInput`, `AutomationOperationService`,
`AutomationPlanEvents`, `AutomationPrompts`, `AutomationReads`,
`AutomationRunEnding`, `AutomationRunExecutor`, `AutomationSchedule`,
`AutomationScheduler`, `AutomationScriptProcess`, `AutomationService`,
`AutomationViews`, `AutomationWrites`.

### GitHub, Google and Discord (38)

- `github/` (16): `GitHubConflictResolver`, `GitHubConnectionTester`,
  `GitHubCreationIdentity`, `GitHubExternalIssueDetector`,
  `GitHubExternalIssueTriage`, `GitHubIssueMapping`, `GitHubIssuePuller`,
  `GitHubIssuePusher`, `GitHubLocalChange`, `GitHubPullRequestService`,
  `GitHubSyncAccessGuard`, `GitHubSyncBackoff`, `GitHubSyncContextLoader`,
  `GitHubSyncRun`, `GitHubSyncRunner`, `RepositoryReadService`.
- `google/` (15): `GoogleDriveConnectionService`, `GoogleDriveFileService`,
  `GoogleDriveSimulatedConnection`, `GoogleDriveStorageService`,
  `StorageAccessService`, `StorageAccountBrowse`, `StorageAccountFiles`,
  `StorageBatchWriter`, `StorageConfirmations`, `StorageFileReader`,
  `StorageFileRequests` (type only), `StorageFileSupport`, `StorageFileWriter`,
  `StorageFolderCopier`, `StoragePathResolver`.
- `discord/` (7): `DiscordAuthorizationService`, `DiscordChannelCatalog`,
  `DiscordConnectionService`, `DiscordDeliveryScheduler`,
  `DiscordDeliveryWorker`, `DiscordNotificationService`,
  `DiscordSubjectLookup`.

### Remote and integrations (25)

- `remote/` (18): `RemoteAccess`, `RemoteConnectionInput`,
  `RemoteConnectionSecrets`, `RemoteConnectionService`, `RemoteConnectionTest`,
  `RemoteConsoleConductor` (type only), `RemoteConsoleService`,
  `RemoteConsoleSession`, `RemoteDirectoryCheck`, `RemoteWorkspaceService`,
  `setup/RemoteInstallProbe`, `setup/RemoteInstallService`,
  `setup/RemoteInstallView`, `setup/RemoteSetupConductor`,
  `setup/RemoteSetupService`, `setup/SetupMarkerFilter`, `setup/SetupPairing`,
  `setup/SetupProgressModel`.
- `integrations/` (7): `GitHubJobClient`, `GitHubJobErrors`,
  `GitHubJobWorker`, `IntegrationFcmConsumer`, `IntegrationProcessing`,
  `IntegrationRunAccess`, `IntegrationServices`.

### Management, system, interpreters and search (25)

- `management/` (14): `ManagementAudit`, `ManagementAvatar`,
  `ManagementCatalog`, `ManagementContext` (type only),
  `ManagementMembershipPolicy`, `ManagementOperations`,
  `ManagementPlanAccess`, `ManagementPolicy`, `ManagementRequest`,
  `ManagementRevision`, `ManagementService`, `ManagementUserRead`,
  `ManagementUserWrite`, `SendmailInvitationDelivery`.
- `system/` (6): `DeploymentBuild`, `PeriodicValue`,
  `SystemDashboardService`, `SystemDiskMonitor`, `SystemLoadSampler`,
  `SystemSources`.
- `interpreters/` (2): `InterpreterProfiles`, `InterpreterVersionCheck`.
- `search/` (3): `EmbeddingModels`, `HybridSearchService`,
  `SearchIndexService`.

## Remaining service areas (expressly open)

The remaining 1,191 tracked files under `backend/service/` (1,166 source
modules, 16 existing test files and 9 Markdown files) are not part of these
eight groups and remain open:

| Area under `backend/service/`       | Source modules | Existing tests | Non-TS files | Changes since `3d381c25` |
| ----------------------------------- | -------------- | -------------- | ------------ | ------------------------ |
| `agents/`                           | 559            | 10             | 7            | +2 added, 11 modified    |
| `chat/`                             | 140            | 0              | 2            | 2 modified               |
| `conversation/`                     | 85             | 0              | 0            | +1 added, 7 modified     |
| `employee/`                         | 97             | 0              | 0            | 1 modified               |
| `mcp/`                              | 109            | 1              | 0            | none                     |
| `mobile/`                           | 75             | 0              | 0            | none                     |
| `runner/`                           | 49             | 5              | 0            | none                     |
| `design/`                           | 15             | 0              | 0            | none                     |
| `speech/`                           | 13             | 0              | 0            | none                     |
| Root files (`backend/service/*.ts`) | 24             | 0              | 0            | none                     |

The 24 root modules directly in `backend/service/` are: `AdministrationAccess`,
`AdministrationService`, `AnnouncingTaskService`, `BackgroundSaveCoordinator`,
`BoardPreferencesService`, `DepartmentAdministrationService`,
`DesignThemeService`, `GitHubSyncService`, `GroupAdministrationService`,
`HealthService`, `InstanceSettingsService`, `InterfaceOperationJournal`,
`LegacyProjectAuthorization`, `MilestoneValidation`, `PagesAgentApiService`,
`ProjectService`, `RoleAdministrationService`, `ServerSettingsService`,
`SettingsService`, `TaskService`, `TaskTemplateService`, `UserCreationService`,
`UserService` and `WikiService`.

The 16 existing test files in these remaining areas sit in `agents/` (10),
`mcp/plan/` (1) and `runner/` (5). The 9 non-TypeScript files are Markdown
guides in `agents/` (7) and Pica runtime prompt files in `chat/pica/`
(`AGENTS.md`, `SOUL.md`).

## Not yet selected

None of these eight service groups is selected by `BACKEND_COVERAGE_SECTIONS`
in `vitest.backend.config.ts`. A section needs its test files first: without
them the per-file coverage report would reject every executable module as
missing a measurement. Add each section together with its tests.
