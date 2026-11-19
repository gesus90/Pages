# Pages documentation

Start with the [project overview and local quickstart](../README.md).
These guides are versioned with the source. They can be read without access to
a Pages instance or its private wiki. Some specialized guides are in German.

## Use Pages

- [User guide](UserGuide.md): navigation, drafts, archive rights and design themes.
- [Ticket attachments](TicketAssets.md): upload, image viewing, inventory and offline migration.
- [Pica chat and models](Pica.md), [administrator operator](PicaAdminOperator.md),
  [administrator browser/files](PicaAdminTools.md) and [visual operator browser](PicaOperatorBrowser.md).
- [Agent Plans](AgentPlanRunner.md): editor, ticket parameters, teams, plans that call each other, execution and recovery.
- [Automations](Automations.md), [conversation content cards](ConversationContentCards.md), [code previews in the chat](ChatCodePreviews.md), [video and audio in the chat](ChatVideoAndAudio.md), [documents, tables and binary files in the chat](ChatDocumentsAndFiles.md)
  and [group observer/context](GroupObserver.md).
- [Storage API and Google Drive setup](StorageApi.md).

## Install and operate

- [Configuration and operations](Operations.md): first setup, paths, environment and proxy behavior.
- [PostgreSQL migration, development database, backup and restore](PostgresMigration.md).
- [Database executor](DatabaseExecutor.md): transaction and multi-process writer contracts.
- [Platform services](PlatformServices.md), [static ingress](../deploy/ingress/README.md),
  [core service](../deploy/core/README.md), [plan engine deployment](../deploy/runs/README.md),
  [reverse proxy](../deploy/proxy/README.md) and [backup status service](../deploy/backups/README.md).
- [Integrations](IntegrationsService.md): GitHub/FCM service, GitHub issue states and Discord setup.
- [Logging and correlation](RequestCorrelation.md): log files, retention, errors and cross-process tracing.
- [Agent runtime](AgentRuntime.md): tool manager, Linux provisioning, scheduling, worker units and ACP adapters.
- [Worker memory](AgentWorkerMemory.md), [Claude tool generation](ManagedClaudeCli.md),
  [reservation cleanup](AcpLeaseCleanup.md) and [local session ownership](LocalAgentSessions.md).
- [Agent Plan control and Runner synchronization](AgentPlanControlAndRunnerSync.md) and
  [background work and server stop](BackgroundWorkAndServerStop.md).
- [Remote workspace and runner setup](RemoteSetup.md), [remote console](RemoteConsole.md)
  and [runner protocol/versions](PagesRunner.md).
- [Pica Mobile WebSocket](PicaMobileWebSocket.md) and [push notifications](PicaMobileNotifications.md).
  The native app is maintained in its own project, outside this repository.

## Develop and extend

- [Development and architecture](Development.md), [coding guidelines](../GUIDELINES.md)
  and [coding-agent instructions](../AGENTS.md).
- [Test and CI restart inventory](TestCiRemoval.md): removed suites, retained
  operating functions, validation evidence and external dependencies.
- [Documentation audit](TestCiDocumentationAudit.md): search scope, retained
  historical evidence, current state and transition dependencies.
- [Backend unit-test foundation](BackendTesting.md): Vitest setup, complete
  measurement scope, section thresholds, CI run and validation limits.
- [GitHub, security and setup inventory](BackendGitHubSecuritySetup.md): second
  mandatory section, module boundaries, open areas and validation limits.
- [Script runtime](../backend/service/agents/ScriptRuntime.md),
  [plan retries](../backend/service/agents/PlanRetries.md),
  [branching](../backend/service/agents/branching/README.md),
  [loops](../backend/service/agents/loop/README.md),
  [recovery](../backend/service/agents/recovery/README.md) and
  [execution context/tools](../backend/agents/runtime/README.md).
- ACP capability matrices: [Codex](../backend/agents/acp/CodexAcpCapabilities.md),
  [Claude](../backend/agents/acp/ClaudeAcpCapabilities.md),
  [OpenCode](../backend/agents/acp/OpenCodeAcpCapabilities.md).
- [Paired-device user management API](McpUserManagement.md),
  [Storage API](StorageApi.md#pages-mcp-api) and [z.ai account routing](ZaiAccountType.md).
  The standalone MCP client is outside this repository; these are server contracts,
  not a verified public client installation guide.

## Historical evidence and open boundaries

Historical documents retain the date and limitations of their checks; they are
not claims that a current checkout passed those checks. Where an older description
conflicts with a current contract, follow the current guide and linked code.

- [Documentation inventory, source reconciliation and validation](PAGE-332.md).
- [CI test-tag execution](PAGE-290.md),
  [remote acceptance](PAGE-169.md) and [historical Pica inventory](PicaRuntimeInventory.md).
- [Simulated remote runner stability check](reports/RemoteRunnerMockCheck.md):
  mocked runner, connection and model; no real remote evidence.
- [Wiki companion documents](wiki/): versioned implementation notes. Links
  beginning `/wiki/` in those older notes require access to the relevant Pages
  instance; they are not publicly reachable setup instructions.

## Licenses and assets

- [Pages MIT license](../LICENSE).
- [React Flow MIT notice](../assets/react-flow-LICENSE.txt).
- [Remote console notice](../assets/remote-console-LICENSE.txt).
- [Google Drive image notice](../assets/google-drive/NOTICE.txt).
