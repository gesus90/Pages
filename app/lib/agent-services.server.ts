import path from "node:path";
import { homedir } from "node:os";

import { ConfigFile } from "@/backend/config/ConfigFile";
import { canProcessRuns } from "@/backend/runtime/RunsMode";
import { createAgentToolManager } from "@/backend/service/agents/tools/AgentToolServices";
import { AgentToolStartupService } from "@/backend/service/agents/tools/AgentToolStartupService";
import { AcpResourceScheduler } from "@/backend/service/agents/AcpResourceScheduler";
import { AcpResourceRepository } from "@/backend/database/repositories/agent/AcpResourceRepository";
import {
  readAcpResourceLimitSource,
  readAcpResourceOptions,
} from "@/backend/config/AcpResourceConfig";
import { CatalogProviderClient } from "@/backend/agents/catalog/CatalogProviderClient";
import { AgentCatalogRefresh } from "@/backend/service/agents/AgentCatalogRefresh";
import { AgentCatalogService } from "@/backend/service/agents/AgentCatalogService";
import { AgentCatalogScheduler } from "@/backend/service/agents/AgentCatalogScheduler";
import { AgentCliRuntime } from "@/backend/agents/cli/AgentCliRuntime";
import { AgentCredentialStore } from "@/backend/agents/cli/AgentCredentialStore";
import { CliLocator } from "@/backend/agents/cli/CliLocator";
import { CliProcessRunner } from "@/backend/agents/cli/CliProcessRunner";
import { createApiProviderRegistry } from "@/backend/agents/providers/ApiProviderRegistry";
import { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import { InstanceSecretCipher } from "@/backend/security/InstanceSecretCipher";
import { AgentCheckService } from "@/backend/service/agents/AgentCheckService";
import {
  OpenCodeProviderKeys,
  OpenCodeProviderLinks,
} from "@/backend/service/agents/OpenCodeProviderLinks";
import { AgentCliLoginService } from "@/backend/service/agents/AgentCliLoginService";
import { AgentConnectionService } from "@/backend/service/agents/AgentConnectionService";
import { AgentOperationRegistry } from "@/backend/service/agents/AgentOperationRegistry";
import { ApiTextExecution } from "@/backend/agents/providers/ApiTextExecution";
import { AgentPlanExecution } from "@/backend/agents/AgentPlanExecution";
import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { UserGroupRepository } from "@/backend/database/repositories/UserGroupRepository";
import { AgentConnectionAccess } from "@/backend/service/agents/AgentConnectionAccess";
import { CliSessionExecution } from "@/backend/agents/cli/CliSessionExecution";
import { antigravityContextBinding } from "@/backend/agents/cli/AntigravityContextBinding";
import { CliWorkerUnits } from "@/backend/agents/cli/CliWorkerUnit";
import { LocalSessions } from "@/backend/agents/local/LocalSessions";
import { DurableCliSessions } from "@/backend/agents/local/DurableCliSessions";
import {
  isLocalSessionOwner,
  localSessionOwnerDirectory,
} from "@/backend/agents/local/LocalSessionMode";
import { CHAT_REQUEST_TIMEOUT_MS } from "@/backend/service/chat/ChatExecutionLimits";
import { ChatRequestRegistry } from "@/backend/service/chat/ChatRequestRegistry";
import { AgentAssignmentRepository } from "@/backend/database/repositories/agent/AgentAssignmentRepository";
import { AgentAssignmentService } from "@/backend/service/agents/AgentAssignmentService";
import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import { AgentPlanGitHubCredentials } from "@/backend/service/agents/AgentPlanGitHubCredentials";
import { CliGitHubCredentials } from "@/backend/agents/cli/CliGitHubCredentials";

import { createAgentConfigurationServices } from "./agent-workspace-services.server";
import { createRemoteServices } from "./remote-services.server";
import { createRunnerServices } from "./runner-services.server";

import type { AcpRecoveryScope } from "@/backend/service/agents/resources/AcpLeaseAdmission";
import type { AgentGitBridgeSetting } from "@/backend/config/AgentGitBridgeConfig";
import type { AgentToolManagerService } from "@/backend/service/agents/tools/AgentToolManagerService";
import type { AcpResourceOptions } from "@/definition/AcpResource";
import type { AgentTicketAssetDependencies } from "@/backend/service/agents/AgentTicketAssetService";
import type { Database } from "@/backend/database/Database";
import type { PlanExecution } from "@/backend/agents/AgentPlanExecution";
import type { AgentWorkspaceService } from "@/backend/service/agents/AgentWorkspaceService";
import type { AgentConfigurationApplicationServices } from "./agent-workspace-services.server";
import type { RemoteApplicationServices } from "./remote-services.server";
import type { RunnerApplicationServices } from "./runner-services.server";

export interface AgentApplicationServices
  extends
    AgentConfigurationApplicationServices,
    RemoteApplicationServices,
    RunnerApplicationServices {
  readonly agentToolManagerService: AgentToolManagerService;
  readonly agentToolStartupService: AgentToolStartupService;
  readonly acpResourceScheduler: AcpResourceScheduler;
  readonly agentAssignmentService: AgentAssignmentService;
  readonly agentCatalogService: AgentCatalogService;
  readonly agentCatalogScheduler: AgentCatalogScheduler;
  readonly agentConnectionService: AgentConnectionService;
  readonly agentCheckService: AgentCheckService;
  readonly agentCliLoginService: AgentCliLoginService;
  /** Text runs of the chat; parallel chats share a verified connection. */
  /** The scope of every connection, checked again before each Pica bridge call (PAGE-68). */
  readonly agentConnectionAccess: AgentConnectionAccess;
  /**
   * Running chat answers may use several model calls within one deadline.
   * Shutdown cancels them before the database closes.
   */
  readonly chatRequests: ChatRequestRegistry;
  readonly agentPlanExecution: PlanExecution;
  readonly localSessions?: LocalSessions | null;
  /** Server-only project credentials, resolved live for YOLO plan nodes. */
  readonly agentPlanGitHubCredentials: AgentPlanGitHubCredentials;
  /** Keeps OpenCode's providers in step with the API keys stored in Pages (PAGE-154). */
  readonly openCodeProviderLinks: OpenCodeProviderLinks;
  /** Temporary native gh credentials, also cleaned during interrupted-run recovery. */
  readonly agentCliGitHubCredentials: CliGitHubCredentials;
}

interface ExecutionInput {
  readonly localSessions: LocalSessions | null;
  readonly tools: AgentToolManagerService;
  readonly resources: AcpResourceScheduler;
  /** Instance folders a CLI agent process must not reach. */
  readonly protectedDirectories: readonly string[];
  /** Operator choice: refuse CLI plan steps where no isolation is possible. */
  readonly isIsolationRequired: boolean;
  /** Private folder of the environment files of limited worker units. */
  readonly workerUnitDirectory: string;
  readonly repository: AgentConnectionRepository;
  readonly cipher: InstanceSecretCipher;
  readonly operations: AgentOperationRegistry;
  readonly runtime: AgentCliRuntime;
  readonly store: AgentCredentialStore;
  readonly locator: CliLocator;
  readonly runner: CliProcessRunner;
  readonly access: AgentConnectionAccess;
  readonly github: CliGitHubCredentials;
  readonly catalog: AgentCatalogRefresh;
}

/**
 * Builds model execution and checks around the same connection and provider boundaries.
 */
function createExecutions(
  input: ExecutionInput,
): Pick<
  AgentApplicationServices,
  "agentPlanExecution" | "agentCheckService" | "openCodeProviderLinks"
> {
  const { repository, cipher, operations } = input;
  const agentCheckService = new AgentCheckService({
    repository,
    catalog: input.catalog,
    cipher,
    operations,
    cli: input.runtime,
    providers: createApiProviderRegistry(),
  });
  const cliAdapters = {
    runtime: input.runtime,
    store: input.store,
    locator: input.locator,
    runner: input.runner,
  };
  const direct = new CliSessionExecution({
    ...cliAdapters,
    tools: input.tools,
    resources: isLocalSessionOwner() ? undefined : input.resources,
    github: input.github,
    units: new CliWorkerUnits(
      localSessionOwnerDirectory()
        ? path.join(
            localSessionOwnerDirectory() ?? input.workerUnitDirectory,
            "native-units",
          )
        : input.workerUnitDirectory,
    ),
    isolation: {
      protectedDirectories: input.protectedDirectories,
      isRequired: input.isIsolationRequired,
      readOnlyDirectories: [
        input.tools.directory,
        path.dirname(process.execPath),
        path.join(
          path.dirname(path.dirname(process.execPath)),
          "lib",
          "node_modules",
        ),
      ],
      hiddenDirectories: [homedir()],
    },
  });
  return {
    agentCheckService,
    openCodeProviderLinks: new OpenCodeProviderLinks({
      connections: repository,
      check: (actor, id) => agentCheckService.run(actor, id, "auth"),
      refreshCatalog: (id) => input.catalog.run(id),
    }),
    agentPlanExecution: new AgentPlanExecution(
      new ApiTextExecution(repository, cipher),
      input.localSessions
        ? new DurableCliSessions(input.localSessions, direct)
        : direct,
      operations,
      input.access,
    ),
  };
}

/** Keeps project authorization and temporary CLI credential storage on the server. */
function createGitHubCredentials(input: {
  readonly database: Database;
  readonly dataDirectory: string;
  readonly tokenKey: Buffer;
  readonly workspaces: AgentWorkspaceService;
  readonly gitBridges?: readonly AgentGitBridgeSetting[];
}): Pick<
  AgentApplicationServices,
  "agentPlanGitHubCredentials" | "agentCliGitHubCredentials"
> {
  return {
    agentPlanGitHubCredentials: new AgentPlanGitHubCredentials({
      projects: new ProjectRepository(input.database),
      workspaces: input.workspaces,
      tokenKey: input.tokenKey,
      gitBridges: input.gitBridges,
    }),
    agentCliGitHubCredentials: new CliGitHubCredentials(input.dataDirectory),
  };
}

interface AgentServiceResources {
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

function createCliRuntime(input: {
  readonly dataDirectory: string;
  readonly agentsDirectory: string;
  readonly cipher: InstanceSecretCipher;
  readonly repository: AgentConnectionRepository;
}): {
  readonly store: AgentCredentialStore;
  readonly locator: CliLocator;
  readonly runner: CliProcessRunner;
  readonly runtime: AgentCliRuntime;
  readonly agentToolManagerService: AgentToolManagerService;
} {
  const { dataDirectory, agentsDirectory, cipher, repository } = input;
  const binding = antigravityContextBinding(process.env);
  const store = binding
    ? new AgentCredentialStore(dataDirectory, undefined, binding)
    : new AgentCredentialStore(dataDirectory);
  const runner = new CliProcessRunner();
  const agentToolManagerService = createAgentToolManager({
    instanceDirectory: path.dirname(agentsDirectory),
    locator: new CliLocator(),
    runner,
  });
  const locator = new CliLocator(undefined, undefined, (binary) =>
    agentToolManagerService.locate(binary),
  );
  const runtime = new AgentCliRuntime({
    store,
    locator,
    runner,
    cipher,
    tools: agentToolManagerService,
    linkedKeys: new OpenCodeProviderKeys(repository, cipher),
  });
  return { store, locator, runner, runtime, agentToolManagerService };
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

/** Applies the same persisted resource limits to all agent execution services. */
function createAcpResources(
  database: Database,
  resources: AgentServiceResources,
): AcpResourceScheduler {
  return new AcpResourceScheduler({
    store: new AcpResourceRepository(database),
    recoveryScope: resources.recoveryScope,
    readOptions: resourceOptionsReader(resources),
    options: readAcpResourceOptions(resources.acpOptions),
    limitSource: readAcpResourceLimitSource(resources.acpOptions),
  });
}

/** Creates lazy adapters and one shared login/process registry without running any checks. */
export function createAgentServices(
  database: Database,
  dataDirectory: string,
  tokenKey: Buffer,
  resources: AgentServiceResources,
): AgentApplicationServices {
  const { agentsDirectory, ticketAssets } = resources;
  const repository = new AgentConnectionRepository(database);
  const cipher = new InstanceSecretCipher(tokenKey);
  const operations = new AgentOperationRegistry();
  const acpResourceScheduler = createAcpResources(database, resources);
  const cliRuntime = createCliRuntime({
    dataDirectory,
    agentsDirectory,
    cipher,
    repository,
  });
  const { runtime, agentToolManagerService } = cliRuntime;
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
  const agentCliLoginService = new AgentCliLoginService({
    repository,
    ...cliRuntime,
    operations,
    catalog: refresh,
  });
  const access = new AgentConnectionAccess({
    connections: repository,
    authorization: new AuthorizationRepository(database),
    groups: new UserGroupRepository(database),
  });
  const github = createGitHubCredentials({
    database,
    dataDirectory,
    tokenKey,
    workspaces: configuration.agentWorkspaceService,
  });
  const remote = createRemoteServices({ database, cipher });
  return {
    ...configuration,
    ...github,
    ...remote,
    ...createRunnerServices({
      database,
      remote,
      tokenKey,
      configuration,
    }),
    acpResourceScheduler,
    localSessions,
    agentToolManagerService,
    agentToolStartupService: new AgentToolStartupService({
      manager: agentToolManagerService,
      connections: repository,
      runtime,
      resources: acpResourceScheduler,
    }),
    agentConnectionAccess: access,
    ...createAssignments(database, repository),
    ...createExecutions({
      localSessions,
      tools: agentToolManagerService,
      resources: acpResourceScheduler,
      protectedDirectories: [dataDirectory, agentsDirectory],
      isIsolationRequired: process.env.PAGES_CLI_ISOLATION === "required",
      workerUnitDirectory: path.join(dataDirectory, "worker-units"),
      repository,
      cipher,
      operations,
      ...cliRuntime,
      access,
      github: github.agentCliGitHubCredentials,
      catalog: refresh,
    }),
    chatRequests: new ChatRequestRegistry({
      timeoutMs: CHAT_REQUEST_TIMEOUT_MS,
      capacity: 16,
    }),
    ...createAgentCatalogServices(repository, refresh, operations),
    agentCliLoginService,
    agentConnectionService: new AgentConnectionService({
      repository,
      cipher,
      operations,
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
    client: new CatalogProviderClient(),
    cli: runtime,
  });
}

function resourceOptionsReader(
  resources: AgentServiceResources,
): (() => Promise<AcpResourceOptions>) | undefined {
  if (
    !resources.configPath ||
    !resources.recoveryScope ||
    resources.recoveryScope === "all"
  )
    return undefined;
  const configFile = new ConfigFile(resources.configPath);
  return async () => {
    const config = await configFile.read();
    if (!config) throw new Error("ACP configuration disappeared");
    return readAcpResourceOptions(config);
  };
}
