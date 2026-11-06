import path from "node:path";

import { createRemoteServices } from "@/app/lib/remote-services.server";
import { createPlanWorkspaceAccess } from "@/app/lib/plan-access-services.server";
import { createAgentConfigurationServices } from "@/app/lib/agent-workspace-services.server";
import { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import { AgentPlanRepository } from "@/backend/database/repositories/agent/AgentPlanRepository";
import { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";
import { InstanceSecretCipher } from "@/backend/security/InstanceSecretCipher";
import { AgentOperationRegistry } from "@/backend/service/agents/AgentOperationRegistry";
import { AgentPlanOwnerRunReader } from "@/backend/service/agents/AgentPlanOwnerRunReader";
import {
  AgentPlanRemoteTargets,
  requireRemoteRunResources,
} from "@/backend/service/agents/AgentPlanRemoteTargets";
import { AgentPlanTasks } from "@/backend/service/agents/AgentPlanTasks";

import type { Database } from "@/backend/database/Database";
import type { IntegrationServices } from "./IntegrationServices";

/** Wires the same run authorization used by the API, with no plan engine or runner startup. */
export function createIntegrationRunAccess(input: {
  readonly database: Database;
  readonly directory: string;
  readonly agentsDirectory: string;
  readonly tokenKey: Buffer;
  readonly services: IntegrationServices;
}): AgentPlanOwnerRunReader {
  const { database, services } = input;
  // These factories only construct access/catalog objects. No login, tool provisioning,
  // runner recovery, SSH session, model request, or scheduler is started here.
  const configuration = createAgentConfigurationServices({
    database,
    dataDirectory: path.resolve(input.directory),
    agentsDirectory: input.agentsDirectory,
    connections: new AgentConnectionRepository(database),
    operations: new AgentOperationRegistry(),
    ticketAssets: services.ticketAssets,
  });
  const remote = createRemoteServices({
    database,
    cipher: new InstanceSecretCipher(input.tokenKey),
  });
  const { access, workspaceCatalog } = createPlanWorkspaceAccess(
    {
      database,
      agents: {
        agentWorkspaceService: configuration.agentWorkspaceService,
        remoteWorkspaceService: remote.remoteWorkspaceService,
      },
    },
    new AgentPlanRepository(database),
  );
  const targets = new AgentPlanRemoteTargets(
    remote.remoteWorkspaceService,
    remote.remoteConnectionService,
  );
  return new AgentPlanOwnerRunReader({
    access,
    workspaceCatalog,
    runs: new AgentPlanRunRepository(database),
    workspaces: configuration.agentWorkspaceService,
    profiles: configuration.agentProfileService,
    parameters: configuration.agentParameterService,
    tasks: new AgentPlanTasks(services.tasks, services.users),
    remoteExecution: {
      requireRead: (userId, resources) =>
        requireRemoteRunResources(targets, userId, resources),
    },
  });
}
