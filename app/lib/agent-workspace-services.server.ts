import { homedir } from "node:os";
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
import { AgentDefinitionFiles } from "@/backend/service/agents/AgentDefinitionFiles";
import { AgentRunArchive } from "@/backend/service/agents/AgentRunArchive";
import { PageAgentService } from "@/backend/service/agents/PageAgentService";
import { PageAgentRunRepository } from "@/backend/database/repositories/agent/PageAgentRunRepository";

import type { Database } from "@/backend/database/Database";
import type { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import type { AgentOperationRegistry } from "@/backend/service/agents/AgentOperationRegistry";

/** The existing central agent and the workspace registry share live account and project boundaries. */
export interface AgentConfigurationApplicationServices {
  readonly agentProfileService: AgentProfileService;
  readonly agentWorkspaceService: AgentWorkspaceService;
  readonly agentParameterService: AgentParameterService;
  readonly pageAgentService: PageAgentService;
  readonly agentDefinitionFiles: AgentDefinitionFiles;
  readonly agentRunArchive: AgentRunArchive;
}

/**
 * The directories a workspace may live in.
 *
 * @remarks
 * `PAGES_WORKSPACE_ROOTS` is an operator's decision and wins. Without it the
 * home directory of the account that runs Pages is the root, as it is for the
 * default configuration folder, so registration works without a variable. The
 * instance's own folders stay excluded either way.
 */
function resolveWorkspaceRoots(): readonly string[] {
  const configured = (process.env.PAGES_WORKSPACE_ROOTS ?? "")
    .split(path.delimiter)
    .map((root) => root.trim())
    .filter(Boolean);
  if (configured.length > 0) return configured;
  return [homedir()].filter(Boolean);
}

/** Wires registration and parameter preparation without filesystem writes or runner starts. */
export function createAgentConfigurationServices(input: {
  readonly database: Database;
  readonly dataDirectory: string;
  /** Folder of the `AGENT.md` and run records of every agent; separate from the data folder. */
  readonly agentsDirectory: string;
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
    projects,
    paths: new AgentWorkspacePath({
      roots: resolveWorkspaceRoots(),
      protectedDirectory: input.dataDirectory,
      additionalProtectedDirectories: [input.agentsDirectory],
    }),
  });
  const profiles = new AgentProfileRepository(database);
  const agentDefinitionFiles = new AgentDefinitionFiles(
    input.agentsDirectory,
    () => profiles.list(),
  );
  const dependencies = {
    profiles,
    connections: input.connections,
    authorization,
    groups,
    operations: input.operations,
    content,
    workspaces: agentWorkspaceService,
    files: agentDefinitionFiles,
  };
  const agentProfileService = new AgentProfileService(dependencies);
  return {
    agentProfileService,
    agentWorkspaceService,
    pageAgentService: new PageAgentService(
      dependencies,
      agentProfileService,
      agentDefinitionFiles,
    ),
    agentDefinitionFiles,
    agentRunArchive: new AgentRunArchive(
      new PageAgentRunRepository(database),
      input.agentsDirectory,
    ),
    agentParameterService: new AgentParameterService({
      profiles: agentProfileService,
      workspaces: agentWorkspaceService,
      authorization,
      content,
    }),
  };
}
