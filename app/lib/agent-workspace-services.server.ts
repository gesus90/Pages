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
import { UserRepository } from "@/backend/database/repositories/UserRepository";
import { AgentTicketParameterService } from "@/backend/service/agents/AgentTicketParameterService";
import { createAgentTaskContext } from "@/backend/service/agents/AgentTaskAccess";
import { AgentTicketAssetService } from "@/backend/service/agents/AgentTicketAssetService";
import { AgentError } from "@/backend/error/AgentErrors";
import { PicaSettingsRepository } from "@/backend/database/repositories/chat/PicaSettingsRepository";
import { PicaSettingsService } from "@/backend/service/chat/PicaSettingsService";

import type { AgentTicketAssetDependencies } from "@/backend/service/agents/AgentTicketAssetService";
import type { Database } from "@/backend/database/Database";
import type { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import type { AgentOperationRegistry } from "@/backend/service/agents/AgentOperationRegistry";
import type { AgentWorkspacePathOptions } from "@/backend/service/agents/AgentWorkspacePath";

/** The existing central agent and the workspace registry share live account and project boundaries. */
export interface AgentConfigurationApplicationServices {
  readonly agentTicketParameterService: AgentTicketParameterService;
  readonly agentContentAccess: AgentContentAccess;
  readonly agentTicketAssetService: AgentTicketAssetService;
  readonly agentProfileService: AgentProfileService;
  readonly agentWorkspaceService: AgentWorkspaceService;
  readonly agentParameterService: AgentParameterService;
  readonly pageAgentService: PageAgentService;
  readonly agentDefinitionFiles: AgentDefinitionFiles;
  readonly agentRunArchive: AgentRunArchive;
  readonly picaSettingsService: PicaSettingsService;
}

/**
 * The directories a workspace may live in.
 *
 * @remarks
 * `PAGES_WORKSPACE_ROOTS` is an operator's decision to narrow them and wins.
 * Without it every existing directory of this machine qualifies, so no
 * variable is needed; the folder browser opens at the home directory of the
 * account that runs Pages. The instance's own folders stay excluded either
 * way, and the account's file permissions still decide what can be used.
 *
 * @returns The roots and, without a configured narrowing, the opening level.
 */
export function resolveWorkspaceRoots(): Pick<
  AgentWorkspacePathOptions,
  "roots" | "startDirectory"
> {
  const configured = (process.env.PAGES_WORKSPACE_ROOTS ?? "")
    .split(path.delimiter)
    .map((root) => root.trim())
    .filter(Boolean);
  if (configured.length > 0) return { roots: configured };
  const home = homedir();
  return { roots: [path.parse(home).root || path.sep], startDirectory: home };
}

/** Wires registration and parameter preparation without filesystem writes or runner starts. */
export function createAgentConfigurationServices(input: {
  readonly database: Database;
  readonly dataDirectory: string;
  /** Folder of the `AGENT.md` and run records of every agent; separate from the data folder. */
  readonly agentsDirectory: string;
  readonly connections: AgentConnectionRepository;
  readonly operations: AgentOperationRegistry;
  readonly ticketAssets: AgentTicketAssetDependencies;
}): AgentConfigurationApplicationServices {
  const { database } = input;
  const authorization = new AuthorizationRepository(database);
  const groups = new UserGroupRepository(database);
  const projects = new ProjectRepository(database);
  const content = new AgentContentAccess(
    projects,
    new WikiRepository(database),
  );
  const users = new UserRepository(database);
  const assets = new AgentTicketAssetService(input.ticketAssets);
  const tickets = new AgentTicketParameterService(async (userId) => {
    const actor = await users.findById(userId);
    if (!actor?.isActive) throw new AgentError("agent_usage_denied");
    return createAgentTaskContext(database, actor, "chat");
  }, assets);
  const agentWorkspaceService = new AgentWorkspaceService({
    workspaces: new AgentWorkspaceRepository(database),
    authorization,
    projects,
    paths: new AgentWorkspacePath({
      ...resolveWorkspaceRoots(),
      protectedDirectory: input.dataDirectory,
      additionalProtectedDirectories: [
        input.agentsDirectory,
        path.join(path.dirname(input.agentsDirectory), "tools"),
      ],
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
    tickets,
    workspaces: agentWorkspaceService,
    files: agentDefinitionFiles,
  };
  const picaSettingsService = new PicaSettingsService({
    ...dependencies,
    settings: new PicaSettingsRepository(database),
  });
  const agentProfileService = new AgentProfileService({
    ...dependencies,
    pica: picaSettingsService,
  });
  return {
    agentTicketParameterService: tickets,
    agentContentAccess: content,
    agentTicketAssetService: assets,
    picaSettingsService,
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
      tickets,
    }),
  };
}
