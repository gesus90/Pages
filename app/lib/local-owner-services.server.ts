import path from "node:path";

import { resolveAgentsDirectory } from "@/backend/config/PagesConfig";
import { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import { AgentPlanRepository } from "@/backend/database/repositories/agent/AgentPlanRepository";
import { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";
import { CodexPlanUsageRepository } from "@/backend/database/repositories/agent/CodexPlanUsageRepository";
import { AgentOperationRegistry } from "@/backend/service/agents/AgentOperationRegistry";
import { AgentLocalSessionPreparation } from "@/backend/service/agents/AgentLocalSessionPreparation";
import { AgentPlanStepStart } from "@/backend/service/agents/AgentPlanStepStart";
import { AgentPlanTasks } from "@/backend/service/agents/AgentPlanTasks";
import { CodexAgentBudget } from "@/backend/service/agents/usage/CodexAgentBudget";
import { InstanceSecretCipher } from "@/backend/security/InstanceSecretCipher";
import { resolveGitHubTokenKey } from "@/backend/github/GitHubTokenKey";
import { AgentPlanExecution } from "@/backend/agents/AgentPlanExecution";
import { ApiTextExecution } from "@/backend/agents/providers/ApiTextExecution";
import { AgentConnectionAccess } from "@/backend/service/agents/AgentConnectionAccess";
import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { UserGroupRepository } from "@/backend/database/repositories/UserGroupRepository";
import { ClaudeMonthlyBudget } from "@/backend/service/agents/sessions/ClaudeMonthlyBudget";
import { ClaudeMonthlyBudgetRepository } from "@/backend/database/repositories/agent/ClaudeMonthlyBudgetRepository";

import { createRemoteAccessServices } from "./remote-services.server";
import { createPlanWorkspaceAccess } from "./plan-access-services.server";
import { createPlanFoundation } from "./plan-foundation.server";
import { createPlanAgentConfiguration } from "./plan-agent-configuration.server";
import {
  createCliRuntime,
  createDirectCliExecution,
  createGitHubCredentials,
} from "./agent-execution-runtime.server";

import type { Database } from "@/backend/database/Database";
import type { PagesRuntime } from "@/backend/runtime/PagesRuntime";
import type { PlanExecution } from "@/backend/agents/AgentPlanExecution";

/** Only the preparation and native execution owned by one local session. */
export interface LocalOwnerServices {
  readonly agentLocalSessionPreparation: AgentLocalSessionPreparation;
  readonly agentPlanExecution: PlanExecution;
  /** Drains the native tool registry and lazy remote readers after the owned session closed. */
  close(): Promise<void>;
}

/** Reuses the owner's database and current authorization without opening the application service graph. */
export function createLocalOwnerServices(
  database: Database,
  runtime: PagesRuntime,
): LocalOwnerServices {
  const databasePath = runtime.getDatabasePath();
  const dataDirectory = path.dirname(databasePath);
  const tokenKey = resolveGitHubTokenKey(databasePath);
  const agentsDirectory = resolveAgentsDirectory(runtime.configFile.path);
  const foundation = createPlanFoundation({ database, databasePath, tokenKey });
  const repository = new AgentConnectionRepository(database);
  const cipher = new InstanceSecretCipher(tokenKey);
  const operations = new AgentOperationRegistry();
  const { services: configuration } = createPlanAgentConfiguration({
    database,
    dataDirectory,
    agentsDirectory,
    connections: repository,
    operations,
    ticketAssets: foundation.ticketAssets,
  });
  const cli = createCliRuntime({ dataDirectory, agentsDirectory, cipher });
  const github = createGitHubCredentials({
    database,
    dataDirectory,
    tokenKey,
    workspaces: configuration.agentWorkspaceService,
    gitBridges: runtime.getConfig().agentGitBridges,
  });
  const remote = createRemoteAccessServices({ database, cipher });
  const { access } = createPlanWorkspaceAccess(
    { database, agents: { ...configuration, ...remote } },
    new AgentPlanRepository(database),
  );
  const start = new AgentPlanStepStart({
    codexBudget: new CodexAgentBudget(new CodexPlanUsageRepository(database)),
    access,
    tasks: new AgentPlanTasks(foundation.tasks, foundation.users),
    profiles: configuration.agentProfileService,
    parameters: configuration.agentParameterService,
    files: configuration.agentDefinitionFiles,
    github: github.agentPlanGitHubCredentials,
  });
  const direct = createDirectCliExecution({
    ...cli,
    repository,
    cipher,
    tools: cli.agentToolManagerService,
    resources: undefined,
    github: github.agentCliGitHubCredentials,
    protectedDirectories: [dataDirectory, agentsDirectory],
    workerUnitDirectory: path.join(dataDirectory, "worker-units"),
    isIsolationRequired: process.env.PAGES_CLI_ISOLATION === "required",
  });
  return {
    close: async () => {
      await cli.agentToolManagerService.shutdown();
      await remote.remoteSessions.shutdown();
      await remote.sshClient.dispose();
    },
    agentLocalSessionPreparation: new AgentLocalSessionPreparation(
      new AgentPlanRunRepository(database),
      start,
    ),
    agentPlanExecution: createOwnerExecution({
      repository,
      cipher,
      direct,
      operations,
      database,
    }),
  };
}

function createOwnerExecution(input: {
  readonly repository: AgentConnectionRepository;
  readonly cipher: InstanceSecretCipher;
  readonly direct: ReturnType<typeof createDirectCliExecution>;
  readonly operations: AgentOperationRegistry;
  readonly database: Database;
}): PlanExecution {
  return new AgentPlanExecution(
    new ApiTextExecution(input.repository, input.cipher),
    input.direct,
    input.operations,
    new AgentConnectionAccess({
      connections: input.repository,
      authorization: new AuthorizationRepository(input.database),
      groups: new UserGroupRepository(input.database),
      claudeBudget: new ClaudeMonthlyBudget(
        new ClaudeMonthlyBudgetRepository(input.database),
      ),
    }),
  );
}
