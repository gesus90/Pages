import path from "node:path";

import { registerShutdownTask } from "@/backend/runtime/ProcessLifecycle";
import { AgentEnvironmentRepository } from "@/backend/database/repositories/agent/AgentEnvironmentRepository";
import { StorageMaintenanceRepository } from "@/backend/database/repositories/storage/StorageMaintenanceRepository";
import { StorageMaintenance } from "@/backend/storage/StorageMaintenance";
import { PagesEventPublisher } from "@/backend/service/events/PagesEventPublisher";
import { AgentEnvironmentMaintenance } from "@/backend/storage/AgentEnvironmentMaintenance";
import { WikiMaintenanceScheduler } from "@/backend/service/wiki/WikiMaintenanceScheduler";
import { ClaudeMonthlyBudget } from "@/backend/service/agents/sessions/ClaudeMonthlyBudget";
import { ClaudeMonthlyBudgetRepository } from "@/backend/database/repositories/agent/ClaudeMonthlyBudgetRepository";
import { ConfigFile } from "@/backend/config/ConfigFile";
import { pagesTempDirectory } from "@/backend/config/PagesTempDirectory";
import { canProcessRuns } from "@/backend/runtime/RunsMode";
import { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import { InstanceSecretCipher } from "@/backend/security/InstanceSecretCipher";
import { AgentOperationRegistry } from "@/backend/service/agents/AgentOperationRegistry";
import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { UserGroupRepository } from "@/backend/database/repositories/UserGroupRepository";
import { AgentConnectionAccess } from "@/backend/service/agents/AgentConnectionAccess";
import { LocalSessions } from "@/backend/agents/local/LocalSessions";

import { createRemoteAccessServices } from "./remote-services.server";
import { createRunnerProcessingServices } from "./runner-services.server";
import {
  createPlanExecution,
  createGitHubCredentials,
  createCliRuntime,
  createAcpResources,
  createSimulation,
} from "./agent-execution-runtime.server";
import { createPlanAgentConfiguration } from "./plan-agent-configuration.server";
import {
  createChatDecisionSettings,
  createDecisionModelCalls,
} from "./chat-decision-services.server";

import type { AgentToolManagerService } from "@/backend/service/agents/tools/AgentToolManagerService";
import type { Database } from "@/backend/database/Database";
import type {
  AgentApplicationServices,
  AgentServiceResources,
} from "./agent-services.server";

/** Agent boundaries needed by the plan engine and its recovery, without API/chat configuration. */
export type PlanAgentServices = Pick<
  AgentApplicationServices,
  | "agentContentAccess"
  | "agentTicketAssetService"
  | "agentTicketAssetSnapshots"
  | "agentTicketParameterService"
  | "agentWorkspaceService"
  | "agentProfileService"
  | "agentParameterService"
  | "agentDefinitionFiles"
  | "agentRunArchive"
  | "agentPlanAssetService"
  | "acpResourceScheduler"
  | "agentCliGitHubCredentials"
  | "agentPlanGitHubCredentials"
  | "agentPlanExecution"
  | "agentConnectionAccess"
  | "localSessions"
  | "agentSimulation"
  | "agentPlanAssetReferences"
  | "agentToolManagerService"
  | "remoteConnectionService"
  | "remoteWorkspaceService"
  | "runnerService"
  | "runnerOpenRouterService"
  | "chatDecisionSettingsService"
  | "decisionModelCalls"
>;

/** Plan runtime resources drained after the engine stops and before the database closes. */
export interface PlanAgentRuntimeServices extends PlanAgentServices {
  /** Closes lazy SSH sessions after all plan cleanup has finished. */
  closeClients(): Promise<void>;
}

/** Creates execution services only; provider refresh, authentication, chat and HTTP stay in the API. */
export function createPlanAgentServices(
  database: Database,
  dataDirectory: string,
  tokenKey: Buffer,
  resources: AgentServiceResources,
): PlanAgentRuntimeServices {
  const { agentsDirectory, ticketAssets } = resources;
  const repository = new AgentConnectionRepository(database);
  const cipher = new InstanceSecretCipher(tokenKey);
  const operations = new AgentOperationRegistry();
  const acpResourceScheduler = createAcpResources(database, resources);
  const cli = createCliRuntime({ dataDirectory, agentsDirectory, cipher });
  const tools = cli.agentToolManagerService;
  startEnvironmentMaintenance(database, dataDirectory, tools, resources);
  const localSessions = resources.configPath
    ? new LocalSessions({
        database,
        configPath: resources.configPath,
        dataDirectory,
        tokenKey,
        resources: acpResourceScheduler,
        tools,
      })
    : null;
  const { services: configuration } = createPlanAgentConfiguration({
    database,
    dataDirectory,
    agentsDirectory,
    connections: repository,
    operations,
    ticketAssets,
  });
  const github = createGitHubCredentials({
    database,
    dataDirectory,
    tokenKey,
    workspaces: configuration.agentWorkspaceService,
    gitBridges: resources.gitBridges,
  });
  const remote = createRemoteAccessServices({ database, cipher });
  const runners = createRunnerProcessingServices({
    database,
    remote,
    configuration,
  });
  const { access, groups } = createConnectionAccess(database, repository);
  const simulation = createSimulation(tokenKey, ticketAssets);
  const execution = createPlanExecution({
    ...cli,
    repository,
    cipher,
    operations,
    localSessions,
    tools,
    resources: acpResourceScheduler,
    protectedDirectories: [dataDirectory, agentsDirectory],
    isIsolationRequired: process.env.PAGES_CLI_ISOLATION === "required",
    workerUnitDirectory: path.join(dataDirectory, "worker-units"),
    access,
    github: github.agentCliGitHubCredentials,
    ...simulation,
  });
  return {
    closeClients: async () => {
      try {
        await remote.remoteSessions.shutdown();
      } finally {
        await remote.sshClient.dispose();
      }
    },
    ...configuration,
    ...github,
    remoteConnectionService: remote.remoteConnectionService,
    remoteWorkspaceService: remote.remoteWorkspaceService,
    runnerService: runners.runnerService,
    runnerOpenRouterService: runners.runnerOpenRouterService,
    acpResourceScheduler,
    localSessions,
    agentToolManagerService: tools,
    agentPlanExecution: execution,
    agentConnectionAccess: access,
    agentSimulation: simulation.simulation,
    agentPlanAssetReferences: simulation.references,
    chatDecisionSettingsService: createChatDecisionSettings({
      database,
      connections: repository,
      groups,
    }),
    decisionModelCalls: createDecisionModelCalls({
      connections: repository,
      cipher,
    }),
  };
}

/** Builds the connection access of the plan engine together with its group repository. */
function createConnectionAccess(
  database: Database,
  connections: AgentConnectionRepository,
): { access: AgentConnectionAccess; groups: UserGroupRepository } {
  const groups = new UserGroupRepository(database);
  const access = new AgentConnectionAccess({
    connections,
    claudeBudget: new ClaudeMonthlyBudget(
      new ClaudeMonthlyBudgetRepository(database),
    ),
    authorization: new AuthorizationRepository(database),
    groups,
  });
  return { access, groups };
}

/** Periodic file cleanup runs independently of further plan starts, also in the separate runs process. */
export function startEnvironmentMaintenance(
  database: Database,
  directory: string,
  tools: AgentToolManagerService,
  resources: Pick<AgentServiceResources, "configPath" | "events">,
): void {
  if (!canProcessRuns()) return;
  const { configPath } = resources;
  const repository = new AgentEnvironmentRepository(database);
  const files = new AgentEnvironmentMaintenance(directory, repository);
  const config = configPath ? new ConfigFile(configPath) : null;
  const storage = new StorageMaintenance({
    dataDirectory: directory,
    pagesDirectory: configPath
      ? path.dirname(configPath)
      : path.dirname(directory),
    tempDirectory: pagesTempDirectory(),
    repository: new StorageMaintenanceRepository(database),
    events: resources.events ?? new PagesEventPublisher(database),
    readWarningBytes: async () => (await config?.read())?.storageWarningBytes,
    readRetentionDays: async () => (await config?.read())?.storageRetentionDays,
  });
  const scheduler = new WikiMaintenanceScheduler(
    {
      runMaintenance: async () => {
        await storage.run();
        await files.run();
        await database.agentFiles?.collectGarbage(database);
        if (!(await repository.hasActiveWorkers()))
          await tools.runMaintenance();
      },
    },
    60_000,
  );
  scheduler.start();
  registerShutdownTask(
    async () => {
      scheduler.stop();
    },
    { step: "agent_environment_maintenance" },
  );
}
