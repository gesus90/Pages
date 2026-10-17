import path from "node:path";
import { homedir } from "node:os";

import { createAgentToolManager } from "@/backend/service/agents/tools/AgentToolServices";
import { AgentToolStartupService } from "@/backend/service/agents/tools/AgentToolStartupService";
import { AcpResourceScheduler } from "@/backend/service/agents/AcpResourceScheduler";
import { AcpResourceRepository } from "@/backend/database/repositories/agent/AcpResourceRepository";
import { readAcpResourceOptions } from "@/backend/config/AcpResourceConfig";
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
import { AgentCliLoginService } from "@/backend/service/agents/AgentCliLoginService";
import { AgentConnectionService } from "@/backend/service/agents/AgentConnectionService";
import { AgentOperationRegistry } from "@/backend/service/agents/AgentOperationRegistry";
import { AgentTextExecution } from "@/backend/agents/AgentTextExecution";
import { ApiTextExecution } from "@/backend/agents/providers/ApiTextExecution";
import { PicaApiModels } from "@/backend/agents/providers/PicaApiModels";
import { CliTextExecution } from "@/backend/agents/cli/CliTextExecution";
import { AgentPlanExecution } from "@/backend/agents/AgentPlanExecution";
import { ScopedExecution } from "@/backend/agents/ScopedExecution";
import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { UserGroupRepository } from "@/backend/database/repositories/UserGroupRepository";
import { AgentConnectionAccess } from "@/backend/service/agents/AgentConnectionAccess";
import { CliSessionExecution } from "@/backend/agents/cli/CliSessionExecution";
import { TextAssistantSettingsRepository } from "@/backend/database/repositories/assistant/TextAssistantSettingsRepository";
import { TextAgentRoleService } from "@/backend/service/assistant/TextAgentRoleService";
import { AssistantRequestRegistry } from "@/backend/service/assistant/AssistantRequestRegistry";
import { AgentAssignmentRepository } from "@/backend/database/repositories/agent/AgentAssignmentRepository";
import { AgentAssignmentService } from "@/backend/service/agents/AgentAssignmentService";
import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import { AgentPlanGitHubCredentials } from "@/backend/service/agents/AgentPlanGitHubCredentials";
import { CliGitHubCredentials } from "@/backend/agents/cli/CliGitHubCredentials";

import { createAgentConfigurationServices } from "./agent-workspace-services.server";

import type { AgentToolManagerService } from "@/backend/service/agents/tools/AgentToolManagerService";
import type { AcpResourceOptions } from "@/definition/AcpResource";
import type { AgentTicketAssetDependencies } from "@/backend/service/agents/AgentTicketAssetService";
import type { Database } from "@/backend/database/Database";
import type { PlanExecution } from "@/backend/agents/AgentPlanExecution";
import type { TextExecution } from "@/backend/agents/TextExecution";
import type { AgentWorkspaceService } from "@/backend/service/agents/AgentWorkspaceService";
import type { AgentConfigurationApplicationServices } from "./agent-workspace-services.server";

export interface AgentApplicationServices extends AgentConfigurationApplicationServices {
  readonly agentToolManagerService: AgentToolManagerService;
  readonly agentToolStartupService: AgentToolStartupService;
  readonly acpResourceScheduler: AcpResourceScheduler;
  readonly agentAssignmentService: AgentAssignmentService;
  readonly agentCatalogService: AgentCatalogService;
  readonly agentCatalogScheduler: AgentCatalogScheduler;
  readonly agentConnectionService: AgentConnectionService;
  readonly agentCheckService: AgentCheckService;
  readonly agentCliLoginService: AgentCliLoginService;
  readonly textAgentRoleService: TextAgentRoleService;
  /** Every model run passes the scope of its connection before the provider is called. */
  readonly agentTextExecution: TextExecution;
  /** Text runs of the chat; parallel chats share a verified connection. */
  readonly agentChatExecution: TextExecution;
  /** Native Pica models share connection locks and authorization with the existing execution paths. */
  readonly picaApiModels: PicaApiModels;
  /** The scope of every connection, checked again before each Pica bridge call (PAGE-68). */
  readonly agentConnectionAccess: AgentConnectionAccess;
  /**
   * Running chat answers. One answer may run several model calls, so its
   * deadline is longer than that of the text assistant; shutdown cancels them
   * before the database closes.
   */
  readonly chatRequests: AssistantRequestRegistry;
  readonly agentPlanExecution: PlanExecution;
  /** Server-only project credentials, resolved live for YOLO plan nodes. */
  readonly agentPlanGitHubCredentials: AgentPlanGitHubCredentials;
  /** Temporary native gh credentials, also cleaned during interrupted-run recovery. */
  readonly agentCliGitHubCredentials: CliGitHubCredentials;
}

interface ExecutionInput {
  readonly tools: AgentToolManagerService;
  readonly resources: AcpResourceScheduler;
  /** Instance folders a CLI agent process must not reach. */
  readonly protectedDirectories: readonly string[];
  /** Operator choice: refuse CLI plan steps where no isolation is possible. */
  readonly isIsolationRequired: boolean;
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
  | "agentTextExecution"
  | "agentChatExecution"
  | "agentPlanExecution"
  | "agentCheckService"
  | "picaApiModels"
> {
  const { repository, cipher, operations, access } = input;
  const cliAdapters = {
    runtime: input.runtime,
    store: input.store,
    locator: input.locator,
    runner: input.runner,
  };
  return {
    picaApiModels: new PicaApiModels({
      connections: repository,
      cipher,
      access,
      operations,
    }),
    agentCheckService: new AgentCheckService({
      repository,
      catalog: input.catalog,
      cipher,
      operations,
      cli: input.runtime,
      providers: createApiProviderRegistry(),
    }),
    agentTextExecution: new ScopedExecution(
      new AgentTextExecution(
        new ApiTextExecution(repository, cipher),
        new CliTextExecution(cliAdapters),
        operations,
      ),
      access,
    ),
    agentChatExecution: new ScopedExecution(
      new AgentTextExecution(
        new ApiTextExecution(repository, cipher),
        new CliTextExecution(cliAdapters),
        operations,
        "shared",
      ),
      access,
    ),
    agentPlanExecution: new AgentPlanExecution(
      new ApiTextExecution(repository, cipher),
      new CliSessionExecution({
        ...cliAdapters,
        tools: input.tools,
        resources: input.resources,
        github: input.github,
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
      }),
      operations,
      access,
    ),
  };
}

/** Keeps project authorization and temporary CLI credential storage on the server. */
function createGitHubCredentials(input: {
  readonly database: Database;
  readonly dataDirectory: string;
  readonly tokenKey: Buffer;
  readonly workspaces: AgentWorkspaceService;
}): Pick<
  AgentApplicationServices,
  "agentPlanGitHubCredentials" | "agentCliGitHubCredentials"
> {
  return {
    agentPlanGitHubCredentials: new AgentPlanGitHubCredentials({
      projects: new ProjectRepository(input.database),
      workspaces: input.workspaces,
      tokenKey: input.tokenKey,
    }),
    agentCliGitHubCredentials: new CliGitHubCredentials(input.dataDirectory),
  };
}

interface AgentServiceResources {
  readonly acpOptions?: Partial<AcpResourceOptions>;
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
}): {
  readonly store: AgentCredentialStore;
  readonly locator: CliLocator;
  readonly runner: CliProcessRunner;
  readonly runtime: AgentCliRuntime;
  readonly agentToolManagerService: AgentToolManagerService;
} {
  const { dataDirectory, agentsDirectory, cipher } = input;
  const store = new AgentCredentialStore(dataDirectory);
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
  });
  return { store, locator, runner, runtime, agentToolManagerService };
}

function createAssignments(
  database: Database,
  repository: AgentConnectionRepository,
  operations: AgentOperationRegistry,
  profiles: AgentApplicationServices["agentProfileService"],
): Pick<
  AgentApplicationServices,
  "agentAssignmentService" | "textAgentRoleService"
> {
  return {
    agentAssignmentService: new AgentAssignmentService({
      assignments: new AgentAssignmentRepository(database),
      connections: repository,
      operations,
    }),
    textAgentRoleService: new TextAgentRoleService(
      new TextAssistantSettingsRepository(database),
      repository,
      operations,
      profiles,
    ),
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
  const repository = new AgentConnectionRepository(database);
  const cipher = new InstanceSecretCipher(tokenKey);
  const operations = new AgentOperationRegistry();
  const acpResourceScheduler = new AcpResourceScheduler({
    store: new AcpResourceRepository(database),
    options: readAcpResourceOptions(resources.acpOptions),
  });
  const configuration = createAgentConfigurationServices({
    database,
    dataDirectory,
    agentsDirectory,
    connections: repository,
    operations,
    ticketAssets,
  });
  const { store, locator, runner, runtime, agentToolManagerService } =
    createCliRuntime({ dataDirectory, agentsDirectory, cipher });
  const refresh = new AgentCatalogRefresh({
    repository,
    cipher,
    operations,
    client: new CatalogProviderClient(),
    cli: runtime,
  });
  const agentCliLoginService = new AgentCliLoginService({
    repository,
    store,
    locator,
    runner,
    runtime,
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
  return {
    ...configuration,
    ...github,
    acpResourceScheduler,
    agentToolManagerService,
    agentToolStartupService: new AgentToolStartupService({
      manager: agentToolManagerService,
      connections: repository,
      runtime,
      resources: acpResourceScheduler,
    }),
    agentConnectionAccess: access,
    ...createAssignments(
      database,
      repository,
      operations,
      configuration.agentProfileService,
    ),
    ...createExecutions({
      tools: agentToolManagerService,
      resources: acpResourceScheduler,
      protectedDirectories: [dataDirectory, agentsDirectory],
      isIsolationRequired: process.env.PAGES_CLI_ISOLATION === "required",
      repository,
      cipher,
      operations,
      runtime,
      store,
      locator,
      runner,
      access,
      github: github.agentCliGitHubCredentials,
      catalog: refresh,
    }),
    chatRequests: new AssistantRequestRegistry({
      timeoutMs: 300_000,
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
