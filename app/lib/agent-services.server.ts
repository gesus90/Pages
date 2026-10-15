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

import type { AgentTicketAssetDependencies } from "@/backend/service/agents/AgentTicketAssetService";
import type { Database } from "@/backend/database/Database";
import type { PlanExecution } from "@/backend/agents/AgentPlanExecution";
import type { TextExecution } from "@/backend/agents/TextExecution";
import type { AgentWorkspaceService } from "@/backend/service/agents/AgentWorkspaceService";
import type { AgentConfigurationApplicationServices } from "./agent-workspace-services.server";

export interface AgentApplicationServices extends AgentConfigurationApplicationServices {
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
> {
  const { repository, cipher, operations, access } = input;
  const cliAdapters = {
    runtime: input.runtime,
    store: input.store,
    locator: input.locator,
    runner: input.runner,
  };
  return {
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
        github: input.github,
        isolation: {
          protectedDirectories: input.protectedDirectories,
          isRequired: input.isIsolationRequired,
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
  const configuration = createAgentConfigurationServices({
    database,
    dataDirectory,
    agentsDirectory,
    connections: repository,
    operations,
    ticketAssets,
  });
  const store = new AgentCredentialStore(dataDirectory);
  const locator = new CliLocator();
  const runner = new CliProcessRunner();
  const runtime = new AgentCliRuntime({ store, locator, runner });
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
    agentAssignmentService: new AgentAssignmentService({
      assignments: new AgentAssignmentRepository(database),
      connections: repository,
      operations,
    }),
    textAgentRoleService: new TextAgentRoleService(
      new TextAssistantSettingsRepository(database),
      repository,
      operations,
      configuration.agentProfileService,
    ),
    ...createExecutions({
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
