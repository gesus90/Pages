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
import { PageAgentRunRepository } from "@/backend/database/repositories/agent/PageAgentRunRepository";
import { UserRepository } from "@/backend/database/repositories/UserRepository";
import { AgentTicketParameterService } from "@/backend/service/agents/AgentTicketParameterService";
import { createAgentTaskContext } from "@/backend/service/agents/AgentTaskAccess";
import { AgentTicketAssetService } from "@/backend/service/agents/AgentTicketAssetService";
import { AgentTicketAssetSnapshots } from "@/backend/service/agents/AgentTicketAssetSnapshots";
import { AgentError } from "@/backend/error/AgentErrors";

import type { AgentTicketAssetDependencies } from "@/backend/service/agents/AgentTicketAssetService";
import type { Database } from "@/backend/database/Database";
import type { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import type { AgentOperationRegistry } from "@/backend/service/agents/AgentOperationRegistry";
import type { AgentWorkspacePathOptions } from "@/backend/service/agents/AgentWorkspacePath";
import type { ProfileDependencies } from "@/backend/service/agents/AgentProfileService";
import type { AgentConfigurationApplicationServices } from "./agent-workspace-services.server";

/** Configuration and readers required by plan execution, without chat settings or PageAgent UI. */
export interface PlanAgentConfiguration {
  readonly dependencies: ProfileDependencies & {
    readonly tickets: AgentTicketParameterService;
    readonly content: AgentContentAccess;
    readonly workspaces: AgentWorkspaceService;
    readonly files: AgentDefinitionFiles;
  };
  readonly services: Omit<
    AgentConfigurationApplicationServices,
    "pageAgentService" | "picaSettingsService"
  >;
}

/** Shared readers before selecting the API's Pica profile or the plan-only profile. */
export interface AgentConfigurationCore {
  readonly dependencies: PlanAgentConfiguration["dependencies"];
  readonly services: Omit<
    PlanAgentConfiguration["services"],
    "agentProfileService" | "agentParameterService"
  >;
}

/**
 * The directories a workspace may live in.
 * @remarks
 * `PAGES_WORKSPACE_ROOTS` is an operator's decision to narrow them and wins.
 * Without it every existing directory of this machine qualifies, so no
 * variable is needed; the folder browser opens at the home directory of the
 * account that runs Pages. The instance's own folders stay excluded either
 * way, and the account's file permissions still decide what can be used.
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

/** Prepares ticket-parameter services for both chat and agent plans. */
function createAgentTicketParameterService(input: {
  readonly database: Database;
  readonly users: UserRepository;
  readonly authorization: AuthorizationRepository;
  readonly content: AgentContentAccess;
  readonly assets: AgentTicketAssetService;
  readonly snapshots: AgentTicketAssetSnapshots;
}): AgentTicketParameterService {
  return new AgentTicketParameterService(
    async (userId) => {
      const actor = await input.users.findById(userId);
      if (!actor?.isActive) throw new AgentError("agent_usage_denied");
      return createAgentTaskContext(input.database, actor, "chat");
    },
    input.assets,
    async (userId, pageId) => {
      const actor = (await input.authorization.snapshot()).accounts.find(
        (entry) => entry.userId === userId,
      );
      if (!actor?.isActive)
        throw new AgentError("parameter_reference_unavailable");
      return input.content.wiki(actor, pageId);
    },
    input.snapshots,
  );
}

/** Builds plan configuration without loading Pica or chat services. */
export function createAgentConfigurationCore(input: {
  readonly database: Database;
  readonly dataDirectory: string;
  /** Folder of the `AGENT.md` and run records of every agent; separate from the data folder. */
  readonly agentsDirectory: string;
  readonly connections: AgentConnectionRepository;
  readonly operations: AgentOperationRegistry;
  readonly ticketAssets: AgentTicketAssetDependencies;
}): AgentConfigurationCore {
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
  const snapshots = new AgentTicketAssetSnapshots(input.dataDirectory);
  const tickets = createAgentTicketParameterService({
    database,
    users,
    authorization,
    content,
    assets,
    snapshots,
  });
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
  return {
    dependencies,
    services: {
      agentTicketParameterService: tickets,
      agentContentAccess: content,
      agentTicketAssetService: assets,
      agentTicketAssetSnapshots: snapshots,
      agentWorkspaceService,
      agentDefinitionFiles,
      agentRunArchive: new AgentRunArchive(
        new PageAgentRunRepository(database),
        input.agentsDirectory,
      ),
      agentPlanAssetService: input.ticketAssets.plans ?? null,
    },
  };
}

/** Adds model and parameter resolution to a shared set of authorized content readers. */
export function completePlanAgentConfiguration(
  core: AgentConfigurationCore,
  profiles: AgentProfileService,
): PlanAgentConfiguration {
  const { authorization, content, tickets, workspaces } = core.dependencies;
  return {
    dependencies: core.dependencies,
    services: {
      ...core.services,
      agentProfileService: profiles,
      agentParameterService: new AgentParameterService({
        profiles,
        workspaces,
        authorization,
        content,
        tickets,
        ...(core.services.agentPlanAssetService
          ? { planAssets: core.services.agentPlanAssetService }
          : {}),
      }),
    },
  };
}

/** Selects the plan profile without constructing Pica or another parameter service. */
export function createPlanAgentConfiguration(
  input: Parameters<typeof createAgentConfigurationCore>[0],
): PlanAgentConfiguration {
  const core = createAgentConfigurationCore(input);
  return completePlanAgentConfiguration(
    core,
    new AgentProfileService(core.dependencies),
  );
}
