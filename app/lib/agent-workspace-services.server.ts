import path from "node:path";

import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import { UserGroupRepository } from "@/backend/database/repositories/UserGroupRepository";
import { WikiRepository } from "@/backend/database/repositories/WikiRepository";
import { AgentProfileRepository } from "@/backend/database/repositories/agent/AgentProfileRepository";
import { AgentWorkspaceRepository } from "@/backend/database/repositories/agent/AgentWorkspaceRepository";
import { AgentContentAccess } from "@/backend/service/agents/AgentContentAccess";
import { AgentParameterService } from "@/backend/service/agents/AgentParameterService";
import { AgentProfileService } from "@/backend/service/agents/AgentProfileService";
import { AgentWorkspacePath } from "@/backend/service/agents/AgentWorkspacePath";
import { AgentWorkspaceService } from "@/backend/service/agents/AgentWorkspaceService";

import type { Database } from "@/backend/database/Database";
import type { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import type { AgentOperationRegistry } from "@/backend/service/agents/AgentOperationRegistry";

/** The existing central agent and the workspace registry share live authorization boundaries. */
export interface AgentConfigurationApplicationServices {
  readonly agentProfileService: AgentProfileService;
  readonly agentWorkspaceService: AgentWorkspaceService;
  readonly agentParameterService: AgentParameterService;
}

/** Wires registration and parameter preparation without filesystem writes or runner starts. */
export function createAgentConfigurationServices(input: {
  readonly database: Database;
  readonly dataDirectory: string;
  readonly connections: AgentConnectionRepository;
  readonly operations: AgentOperationRegistry;
}): AgentConfigurationApplicationServices {
  const { database } = input;
  const authorization = new AuthorizationRepository(database);
  const groups = new UserGroupRepository(database);
  const projects = new ProjectRepository(database);
  const content = new AgentContentAccess(
    projects,
    new WikiRepository(database),
  );
  const agentWorkspaceService = new AgentWorkspaceService({
    workspaces: new AgentWorkspaceRepository(database),
    authorization,
    groups,
    projects,
    paths: new AgentWorkspacePath({
      roots: (process.env.PAGES_WORKSPACE_ROOTS ?? "")
        .split(path.delimiter)
        .map((root) => root.trim())
        .filter(Boolean),
      protectedDirectory: input.dataDirectory,
    }),
  });
  const agentProfileService = new AgentProfileService({
    profiles: new AgentProfileRepository(database),
    connections: input.connections,
    authorization,
    groups,
    operations: input.operations,
    content,
    workspaces: agentWorkspaceService,
  });
  return {
    agentProfileService,
    agentWorkspaceService,
    agentParameterService: new AgentParameterService({
      profiles: agentProfileService,
      workspaces: agentWorkspaceService,
      authorization,
      content,
    }),
  };
}
