import path from "node:path";

import { ClaudeMonthlyBudget } from "@/backend/service/agents/sessions/ClaudeMonthlyBudget";
import { ClaudeMonthlyBudgetRepository } from "@/backend/database/repositories/agent/ClaudeMonthlyBudgetRepository";
import { canProcessRuns } from "@/backend/runtime/RunsMode";
import { AgentToolStartupService } from "@/backend/service/agents/tools/AgentToolStartupService";
import { AgentToolRebindService } from "@/backend/service/agents/tools/AgentToolRebindService";
import { CatalogProviderClient } from "@/backend/agents/catalog/CatalogProviderClient";
import { AgentCatalogRefresh } from "@/backend/service/agents/AgentCatalogRefresh";
import { AgentCatalogService } from "@/backend/service/agents/AgentCatalogService";
import { AgentCatalogScheduler } from "@/backend/service/agents/AgentCatalogScheduler";
import { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import { InstanceSecretCipher } from "@/backend/security/InstanceSecretCipher";
import { AgentCliLoginService } from "@/backend/service/agents/AgentCliLoginService";
import { AgentConnectionService } from "@/backend/service/agents/AgentConnectionService";
import { AgentOperationRegistry } from "@/backend/service/agents/AgentOperationRegistry";
import { currentAgentSimulationMode } from "@/backend/agents/simulation/AgentSimulationMode";
import { simulationGuardedFetch } from "@/backend/agents/simulation/SimulatedPlanExecution";
import { CatalogHttpClient } from "@/backend/agents/catalog/CatalogHttpClient";
import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { UserGroupRepository } from "@/backend/database/repositories/UserGroupRepository";
import { AgentConnectionAccess } from "@/backend/service/agents/AgentConnectionAccess";
import { LocalSessions } from "@/backend/agents/local/LocalSessions";
import { CHAT_REQUEST_TIMEOUT_MS } from "@/backend/service/chat/ChatExecutionLimits";
import { ChatRequestRegistry } from "@/backend/service/chat/ChatRequestRegistry";
import { AgentAssignmentRepository } from "@/backend/database/repositories/agent/AgentAssignmentRepository";
import { AgentAssignmentService } from "@/backend/service/agents/AgentAssignmentService";

import { startOpenRouterPrices } from "./agent-price-services.server";
import { createAgentConfigurationServices } from "./agent-workspace-services.server";
import { createRemoteServices } from "./remote-services.server";
import { createRunnerServices } from "./runner-services.server";
import { createChatDecisionServices } from "./chat-decision-services.server";
import { createSpeechServices } from "./speech-services.server";
import {
  createExecutions,
  createGitHubCredentials,
  createCliRuntime,
  createAcpResources,
  createSimulation,
} from "./agent-execution-runtime.server";
import { startEnvironmentMaintenance } from "./plan-agent-services.server";

import type { PagesEventPublisher } from "@/backend/service/events/PagesEventPublisher";
import type { AcpResourceScheduler } from "@/backend/service/agents/AcpResourceScheduler";
import type { AgentCliRuntime } from "@/backend/agents/cli/AgentCliRuntime";
import type { AgentCheckService } from "@/backend/service/agents/AgentCheckService";
import type { OpenCodeProviderLinks } from "@/backend/service/agents/OpenCodeProviderLinks";
import type { PlanAssetReferences } from "@/backend/service/agents/assets/PlanAssetReferences";
import type { AgentPlanGitHubCredentials } from "@/backend/service/agents/AgentPlanGitHubCredentials";
import type { CliGitHubCredentials } from "@/backend/agents/cli/CliGitHubCredentials";
import type { AcpRecoveryScope } from "@/backend/service/agents/resources/AcpLeaseAdmission";
import type { AgentGitBridgeSetting } from "@/backend/config/AgentGitBridgeConfig";
import type { AgentToolManagerService } from "@/backend/service/agents/tools/AgentToolManagerService";
import type { AcpResourceOptions } from "@/definition/AcpResource";
import type { AgentTicketAssetDependencies } from "@/backend/service/agents/AgentTicketAssetService";
import type { Database } from "@/backend/database/Database";
import type { PlanExecution } from "@/backend/agents/AgentPlanExecution";
import type { AgentSimulationMode } from "@/backend/agents/simulation/AgentSimulationMode";
import type { AgentConfigurationApplicationServices } from "./agent-workspace-services.server";
import type { RemoteApplicationServices } from "./remote-services.server";
import type { RunnerApplicationServices } from "./runner-services.server";
import type { ChatDecisionApplicationServices } from "./chat-decision-services.server";
import type { SpeechApplicationServices } from "./speech-services.server";

export interface AgentApplicationServices
  extends
    AgentConfigurationApplicationServices,
    RemoteApplicationServices,
    RunnerApplicationServices,
    ChatDecisionApplicationServices,
    SpeechApplicationServices {
  readonly agentToolManagerService: AgentToolManagerService;
  readonly agentToolStartupService: AgentToolStartupService;
  readonly agentToolRebindService: AgentToolRebindService;
  readonly acpResourceScheduler: AcpResourceScheduler;
  readonly agentAssignmentService: AgentAssignmentService;
  readonly agentCatalogService: AgentCatalogService;
  readonly agentCatalogScheduler: AgentCatalogScheduler;
  readonly agentConnectionService: AgentConnectionService;
  readonly agentCheckService: AgentCheckService;
  readonly agentCliLoginService: AgentCliLoginService;
  /** Text runs of the chat; parallel chats share a verified connection. */
  /** The scope of every connection, checked again before each Pica bridge call. */
  readonly agentConnectionAccess: AgentConnectionAccess;
  /**
   * Running chat answers may use several model calls within one deadline.
   * Shutdown cancels them before the database closes.
   */
  readonly chatRequests: ChatRequestRegistry;
  readonly agentPlanExecution: PlanExecution;
  /** The agent simulation; inactive outside development. */
  readonly agentSimulation: AgentSimulationMode;
  /** Signed references through which a runner reaches a plan asset; `null` without a plan asset store. */
  readonly agentPlanAssetReferences: PlanAssetReferences | null;
  readonly localSessions?: LocalSessions | null;
  /** Server-only project credentials, resolved live for YOLO plan nodes. */
  readonly agentPlanGitHubCredentials: AgentPlanGitHubCredentials;
  /** Checks changed API credentials and activates the independent OpenCode free catalog. */
  readonly openCodeProviderLinks: OpenCodeProviderLinks;
  /** Temporary native gh credentials, also cleaned during interrupted-run recovery. */
  readonly agentCliGitHubCredentials: CliGitHubCredentials;
}

/** The connection scope check and the decision model, which share one reading of the groups. */
function createAccessServices(
  database: Database,
  repository: AgentConnectionRepository,
  cipher: InstanceSecretCipher,
): {
  readonly access: AgentConnectionAccess;
} & ChatDecisionApplicationServices {
  const groups = new UserGroupRepository(database);
  return {
    access: new AgentConnectionAccess({
      connections: repository,
      claudeBudget: new ClaudeMonthlyBudget(
        new ClaudeMonthlyBudgetRepository(database),
      ),
      authorization: new AuthorizationRepository(database),
      groups,
    }),
    ...createChatDecisionServices({
      database,
      connections: repository,
      cipher,
      groups,
    }),
  };
}

/** Instance paths, recovery scope and authorized content readers shared by execution roles. */
export interface AgentServiceResources {
  readonly events?: PagesEventPublisher;
  readonly recoveryScope?: AcpRecoveryScope;
  readonly configPath?: string;
  readonly acpOptions?: Partial<AcpResourceOptions>;
  /** Host Git routes an operator configured for single plan steps. */
  readonly gitBridges?: readonly AgentGitBridgeSetting[];
  readonly agentsDirectory: string;
  readonly ticketAssets: AgentTicketAssetDependencies;
}

/** Shares one refresh worker and operation registry between catalog reads and its scheduler. */
function createAgentCatalogServices(
  repository: AgentConnectionRepository,
  refresh: AgentCatalogRefresh,
  operations: AgentOperationRegistry,
): Pick<
  AgentApplicationServices,
  "agentCatalogService" | "agentCatalogScheduler"
> {
  return {
    agentCatalogService: new AgentCatalogService(
      repository,
      refresh,
      operations,
    ),
    agentCatalogScheduler: new AgentCatalogScheduler(
      repository.catalogs(),
      refresh,
    ),
  };
}

function createAssignments(
  database: Database,
  repository: AgentConnectionRepository,
): Pick<AgentApplicationServices, "agentAssignmentService"> {
  return {
    agentAssignmentService: new AgentAssignmentService({
      assignments: new AgentAssignmentRepository(database),
      connections: repository,
    }),
  };
}

/** Creates lazy adapters and one shared login/process registry without running any checks. */
export function createAgentServices(
  database: Database,
  dataDirectory: string,
  tokenKey: Buffer,
  resources: AgentServiceResources,
): AgentApplicationServices {
  const { agentsDirectory, ticketAssets } = resources;
  const simulated = createSimulation(tokenKey, ticketAssets);
  const repository = new AgentConnectionRepository(database);
  const cipher = new InstanceSecretCipher(tokenKey);
  const operations = new AgentOperationRegistry();
  const acpResourceScheduler = createAcpResources(database, resources);
  const cliRuntime = createCliRuntime({
    dataDirectory,
    agentsDirectory,
    cipher,
  });
  const { runtime, agentToolManagerService } = cliRuntime;
  startEnvironmentMaintenance(
    database,
    dataDirectory,
    agentToolManagerService,
    resources,
  );
  const localSessions = createLocalSessions(database, dataDirectory, tokenKey, {
    resources,
    acpResourceScheduler,
    agentToolManagerService,
  });
  const configuration = createAgentConfigurationServices({
    database,
    dataDirectory,
    agentsDirectory,
    connections: repository,
    operations,
    ticketAssets,
  });
  const refresh = createCatalogRefresh(repository, cipher, operations, runtime);
  startOpenRouterPrices(database);
  const { access, ...decision } = createAccessServices(
    database,
    repository,
    cipher,
  );
  const github = createGitHubCredentials({
    database,
    dataDirectory,
    tokenKey,
    workspaces: configuration.agentWorkspaceService,
  });
  const remote = createRemoteServices({ database, cipher });
  const executions = createExecutions({
    localSessions,
    tools: agentToolManagerService,
    resources: acpResourceScheduler,
    ...executionIsolation(dataDirectory, agentsDirectory),
    repository,
    cipher,
    operations,
    ...cliRuntime,
    access,
    github: github.agentCliGitHubCredentials,
    catalog: refresh,
    ...simulated,
  });
  return {
    ...configuration,
    ...github,
    ...remote,
    ...createRunnerServices({ database, remote, tokenKey, configuration }),
    ...createSpeechServices({ database, connections: repository, cipher }),
    ...decision,
    acpResourceScheduler,
    localSessions,
    agentToolManagerService,
    ...createToolServices({
      manager: agentToolManagerService,
      connections: repository,
      runtime,
      resources: acpResourceScheduler,
      checks: executions.agentCheckService,
    }),
    agentConnectionAccess: access,
    ...createAssignments(database, repository),
    ...executions,
    chatRequests: new ChatRequestRegistry({
      timeoutMs: CHAT_REQUEST_TIMEOUT_MS,
      capacity: 16,
    }),
    ...createAgentCatalogServices(repository, refresh, operations),
    ...createConnectionLoginServices({
      repository,
      cipher,
      operations,
      cliRuntime,
      refresh,
    }),
  };
}

// The instance folders a session never sees, and where its worker units are kept.
function executionIsolation(
  dataDirectory: string,
  agentsDirectory: string,
): Pick<
  Parameters<typeof createExecutions>[0],
  "protectedDirectories" | "isIsolationRequired" | "workerUnitDirectory"
> {
  return {
    protectedDirectories: [dataDirectory, agentsDirectory],
    isIsolationRequired: process.env.PAGES_CLI_ISOLATION === "required",
    workerUnitDirectory: path.join(dataDirectory, "worker-units"),
  };
}

// Startup checks and re-binding share the manager with every session start.
function createToolServices(input: {
  readonly manager: AgentToolManagerService;
  readonly connections: AgentConnectionRepository;
  readonly runtime: AgentCliRuntime;
  readonly resources: AcpResourceScheduler;
  readonly checks: AgentCheckService;
}): Pick<
  AgentApplicationServices,
  "agentToolStartupService" | "agentToolRebindService"
> {
  const { manager, connections, runtime, resources, checks } = input;
  return {
    agentToolStartupService: new AgentToolStartupService({
      manager,
      connections,
      runtime,
      resources,
    }),
    agentToolRebindService: new AgentToolRebindService({
      manager,
      connections,
      checks,
    }),
  };
}

function createConnectionLoginServices(input: {
  readonly repository: AgentConnectionRepository;
  readonly cipher: InstanceSecretCipher;
  readonly operations: AgentOperationRegistry;
  readonly cliRuntime: ReturnType<typeof createCliRuntime>;
  readonly refresh: AgentCatalogRefresh;
}): Pick<
  AgentApplicationServices,
  "agentCliLoginService" | "agentConnectionService"
> {
  const agentCliLoginService = new AgentCliLoginService({
    repository: input.repository,
    ...input.cliRuntime,
    operations: input.operations,
    catalog: input.refresh,
  });
  return {
    agentCliLoginService,
    agentConnectionService: new AgentConnectionService({
      repository: input.repository,
      cipher: input.cipher,
      operations: input.operations,
      cli: agentCliLoginService,
    }),
  };
}

function createLocalSessions(
  database: Database,
  dataDirectory: string,
  tokenKey: Buffer,
  input: {
    readonly resources: AgentServiceResources;
    readonly acpResourceScheduler: AcpResourceScheduler;
    readonly agentToolManagerService: AgentToolManagerService;
  },
): LocalSessions | null {
  if (!input.resources.configPath || !canProcessRuns()) return null;
  return new LocalSessions({
    database,
    configPath: input.resources.configPath,
    dataDirectory,
    tokenKey,
    resources: input.acpResourceScheduler,
    tools: input.agentToolManagerService,
  });
}

function createCatalogRefresh(
  repository: AgentConnectionRepository,
  cipher: InstanceSecretCipher,
  operations: AgentOperationRegistry,
  runtime: AgentCliRuntime,
): AgentCatalogRefresh {
  return new AgentCatalogRefresh({
    repository,
    cipher,
    operations,
    client: new CatalogProviderClient(
      new CatalogHttpClient(
        simulationGuardedFetch(currentAgentSimulationMode()),
      ),
    ),
    cli: runtime,
  });
}
