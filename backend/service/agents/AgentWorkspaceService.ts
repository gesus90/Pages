import { randomUUID } from "node:crypto";

import { readWorkspaceInput } from "@/backend/agents/AgentWorkspaceInput";
import { accountForChannel } from "@/backend/auth/McpActorContext";
import { ProjectPolicyService } from "@/backend/auth/ProjectPolicyService";
import { UserPolicyService } from "@/backend/auth/UserPolicyService";
import { SerialQueue } from "@/backend/concurrency/SerialQueue";
import { AgentError } from "@/backend/error/AgentErrors";
import { logCaughtError } from "@/backend/logging/Logger";

import type { ActorChannel } from "@/backend/auth/McpActorContext";
import type { AgentErrorCode } from "@/backend/error/AgentErrors";
import type { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import type { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import type {
  AgentWorkspaceRepository,
  WorkspaceJournal,
} from "@/backend/database/repositories/agent/AgentWorkspaceRepository";
import type { AccountAccess } from "@/definition/Authorization";
import type {
  AgentWorkspace,
  AgentWorkspaceChoice,
  AgentWorkspacePage,
  AgentWorkspaceUsage,
  AgentWorkspaceView,
  ResolvedAgentWorkspace,
  WorkspaceFolderListing,
  WorkspaceFolderRequest,
  WorkspaceGitHub,
} from "@/definition/AgentWorkspace";
import type { Project, ProjectIntegration } from "@/definition/Project";
import type { AgentWorkspacePath } from "./AgentWorkspacePath";

/**
 * Live account, project and filesystem boundaries; none of these grants imply another.
 *
 * @remarks
 * Each boundary names only what the registry calls, so a test can supply
 * exactly that.
 */
export interface AgentWorkspaceDependencies {
  readonly workspaces: Pick<
    AgentWorkspaceRepository,
    "list" | "usages" | "save" | "remove"
  >;
  readonly authorization: Pick<AuthorizationRepository, "snapshot">;
  readonly projects: Pick<
    ProjectRepository,
    | "findAll"
    | "findById"
    | "findIntegration"
    | "findIntegrationsByProjectIds"
    | "findManagedProjectIds"
    | "isProjectManager"
  >;
  readonly paths: Pick<
    AgentWorkspacePath,
    "isConfigured" | "inspect" | "resolve" | "browse"
  >;
  /** Whose administrator reading applies; the interface when absent. */
  readonly channel?: ActorChannel;
}

function toGitHub(
  integration: ProjectIntegration | null | undefined,
): WorkspaceGitHub | null {
  return integration?.repoUrl
    ? { repoUrl: integration.repoUrl, repoName: integration.repoName }
    : null;
}

function departmentIds(project: Project): readonly string[] {
  return project.departments.map((department) => department.id);
}

function canReadProject(actor: AccountAccess, project: Project): boolean {
  return new ProjectPolicyService().canAccess(actor, departmentIds(project));
}

function canManageProject(
  actor: AccountAccess,
  project: Project,
  isProjectManager: boolean,
): boolean {
  const policy = new ProjectPolicyService();
  return (
    policy.canAccess(actor, departmentIds(project)) &&
    policy.canManageWorkspaces(actor, {
      departmentIds: departmentIds(project),
      isProjectManager,
    })
  );
}

/** The projects of a person's readable ones that they may register workspaces for. */
function manageableProjects(
  actor: AccountAccess,
  readable: ReadonlyMap<string, Project>,
  managedIds: readonly string[],
): Project[] {
  const managed = new Set(managedIds);
  return [...readable.values()].filter((project) =>
    canManageProject(actor, project, managed.has(project.id)),
  );
}

/**
 * Registers existing local directories for projects with a GitHub link.
 *
 * @remarks
 * Everyone who can open the project sees and uses its workspaces. Only
 * administrators and the project's managers register, change or remove them.
 */
export class AgentWorkspaceService {
  private readonly dependencies: AgentWorkspaceDependencies;
  private readonly writes: SerialQueue;

  public constructor(
    dependencies: AgentWorkspaceDependencies,
    writes: SerialQueue = new SerialQueue(),
  ) {
    this.dependencies = dependencies;
    this.writes = writes;
  }

  /**
   * Returns the service for another surface that shares storage, rules and write order.
   *
   * @remarks
   * Only the administrator reading differs: MCP counts a personal administrator
   * regardless of the role mode of the browser, the interface does not.
   *
   * @param channel - The surface the returned service acts for.
   */
  public forChannel(channel: ActorChannel): AgentWorkspaceService {
    return new AgentWorkspaceService(
      { ...this.dependencies, channel },
      this.writes,
    );
  }

  /** Lists the workspaces of accessible projects, with management hints and the projects a person may assign. */
  public async page(userId: string): Promise<AgentWorkspacePage> {
    const actor = await this.account(userId);
    const isAdministrator = new UserPolicyService().isAdministrator(actor);
    const { registered, readable, manageable, integrations } =
      await this.projectScope(actor, userId);
    const manageableIds = new Set(manageable.map((project) => project.id));
    // Only administrators see a registration whose project nobody can open any more, so they can clean it up.
    const visible = registered.filter(
      (workspace) => isAdministrator || readable.has(workspace.projectId),
    );
    const workspaces = await Promise.all(
      visible.map((workspace) =>
        this.view(
          workspace,
          readable.get(workspace.projectId),
          toGitHub(integrations.get(workspace.projectId)),
          isAdministrator || manageableIds.has(workspace.projectId),
        ),
      ),
    );
    return {
      canManage: isAdministrator || manageable.length > 0,
      isAdministrator,
      isConfigured: this.dependencies.paths.isConfigured(),
      workspaces,
      projects: manageable.map((project) => ({
        id: project.id,
        name: project.name,
        github: toGitHub(integrations.get(project.id)),
      })),
    };
  }

  /**
   * Lists only the workspaces of projects the person can open right now.
   *
   * @remarks
   * Unlike {@link AgentWorkspaceService.page} it never mentions a registration
   * whose project is hidden or gone, not even to an administrator.
   *
   * @param userId - The signed-in or verified person.
   * @param projectId - Narrows the list to one project, which must be readable.
   */
  public async list(
    userId: string,
    projectId: string | null = null,
  ): Promise<readonly AgentWorkspaceView[]> {
    const actor = await this.account(userId);
    if (projectId !== null) await this.requireProject(actor, projectId);
    const { registered, readable, manageable, integrations } =
      await this.projectScope(actor, userId);
    const manageableIds = new Set(manageable.map((project) => project.id));
    const visible = registered.filter(
      (workspace) =>
        readable.has(workspace.projectId) &&
        (projectId === null || workspace.projectId === projectId),
    );
    return Promise.all(
      visible.map((workspace) =>
        this.view(
          workspace,
          readable.get(workspace.projectId),
          toGitHub(integrations.get(workspace.projectId)),
          manageableIds.has(workspace.projectId),
        ),
      ),
    );
  }

  /**
   * Reads one workspace of a project the person can open.
   *
   * @remarks
   * A workspace of a hidden project answers exactly like a missing one.
   *
   * @param userId - The signed-in or verified person.
   * @param id - Identifier of the registration.
   * @throws {AgentError} `workspace_not_found` for a missing or hidden workspace.
   */
  public async read(userId: string, id: string): Promise<AgentWorkspaceView> {
    const actor = await this.account(userId);
    const workspace = (await this.dependencies.workspaces.list()).find(
      (entry) => entry.id === id,
    );
    const project = workspace
      ? await this.dependencies.projects.findById(workspace.projectId)
      : null;
    if (!workspace || !project || !canReadProject(actor, project))
      throw new AgentError("workspace_not_found");
    const [integration, isProjectManager] = await Promise.all([
      this.dependencies.projects.findIntegration(project.id),
      this.dependencies.projects.isProjectManager(project.id, userId),
    ]);
    return this.view(
      workspace,
      project,
      toGitHub(integration),
      canManageProject(actor, project, isProjectManager),
    );
  }

  /**
   * Rechecks that the person may still register workspaces for a project.
   *
   * @remarks
   * It does not look at a GitHub link, so a stored result of an earlier change
   * can be shown again while the project is only temporarily without one.
   *
   * @param userId - The signed-in or verified person.
   * @param projectId - The project of the earlier change.
   */
  public async requireManagement(
    userId: string,
    projectId: string,
  ): Promise<void> {
    const actor = await this.account(userId);
    await this.requireManager(
      actor,
      await this.requireProject(actor, projectId),
    );
  }

  /**
   * Lists the server directories a workspace could be registered in.
   *
   * @remarks
   * The browser reveals directory names of the server, so it is reserved for
   * those who may register a workspace for at least one project, the same
   * right the registration itself rechecks.
   */
  public async folders(
    userId: string,
    request: WorkspaceFolderRequest,
  ): Promise<WorkspaceFolderListing> {
    const actor = await this.account(userId);
    if (!new UserPolicyService().isAdministrator(actor)) {
      const [readable, managedIds] = await Promise.all([
        this.readableProjects(actor),
        this.dependencies.projects.findManagedProjectIds(userId),
      ]);
      if (manageableProjects(actor, readable, managedIds).length === 0)
        throw new AgentError("workspace_management_denied");
    }
    return this.dependencies.paths.browse(request);
  }

  /** Selection contains only workspaces of accessible projects, including explained path and project failures. */
  public async choices(
    userId: string,
    projectId: string | null = null,
  ): Promise<readonly AgentWorkspaceChoice[]> {
    const actor = await this.account(userId);
    if (projectId !== null) await this.requireProject(actor, projectId);
    const registered = (await this.dependencies.workspaces.list()).filter(
      (workspace) => projectId === null || workspace.projectId === projectId,
    );
    // Only the projects that carry workspaces are read, however many projects exist.
    const readable = await this.readableProjectsOf(
      actor,
      registered.map((workspace) => workspace.projectId),
    );
    const integrations =
      await this.dependencies.projects.findIntegrationsByProjectIds([
        ...readable.keys(),
      ]);
    return Promise.all(
      registered
        .filter((workspace) => readable.has(workspace.projectId))
        .map((workspace) =>
          this.describe(
            workspace,
            readable.get(workspace.projectId),
            toGitHub(integrations.get(workspace.projectId)),
          ),
        ),
    );
  }

  /** Reauthorizes IDs before inspecting a path and returns a real working-directory contract. */
  public async resolve(
    userId: string,
    id: string,
    projectId: string | null = null,
  ): Promise<ResolvedAgentWorkspace> {
    const workspace = await this.authorized(userId, id, projectId);
    const github = await this.requireGitHub(workspace.projectId);
    return {
      id: workspace.id,
      path: await this.dependencies.paths.resolve(workspace),
      directoryIdentity: workspace.directoryIdentity,
      revision: workspace.revision,
      projectId: workspace.projectId,
      github,
    };
  }

  /**
   * Rechecks that the person may still open the workspace's project.
   *
   * @remarks
   * Unlike {@link AgentWorkspaceService.resolve} it does not need a usable
   * directory or a GitHub link, so reading and stopping an execution that
   * already started keeps working when either has gone.
   */
  public async requireAccess(
    userId: string,
    id: string,
    projectId: string | null = null,
  ): Promise<void> {
    await this.authorized(userId, id, projectId);
  }

  /**
   * Stores only a canonical registration for a managed project with a GitHub link; no directory content is touched.
   *
   * @param userId - The signed-in or verified person.
   * @param id - Identifier of the registration to change, or `null` to create one.
   * @param input - The registration as received.
   * @param journal - Records that commit with the change or not at all.
   * @returns The identifier of the registration.
   */
  public async save(
    userId: string,
    id: string | null,
    input: unknown,
    journal?: WorkspaceJournal,
  ): Promise<string> {
    await this.account(userId);
    const proposed = readWorkspaceInput(input);
    return this.writes.run(async () => {
      const previous = await this.requireSaveRights(userId, id, proposed);
      if (previous && proposed.revision !== previous.revision)
        throw new AgentError("workspace_conflict");
      const inspected = await this.dependencies.paths.inspect(proposed.path);
      await this.requireSaveRights(userId, id, proposed);
      const workspaceId = id ?? randomUUID();
      await this.dependencies.workspaces.save(
        {
          name: proposed.name,
          projectId: proposed.projectId,
          id: workspaceId,
          path: inspected.path,
          directoryIdentity: inspected.identity,
          registeredBy: previous?.registeredBy ?? userId,
          revision: previous?.revision ?? 1,
        },
        id === null,
        journal,
      );
      return workspaceId;
    });
  }

  /**
   * Lists what still refers to the workspace.
   *
   * @remarks
   * Names stay with administrators; a project manager only learns what kind of
   * references there are, so private plans and agents are not disclosed.
   */
  public async usages(
    userId: string,
    id: string,
  ): Promise<readonly AgentWorkspaceUsage[]> {
    const actor = await this.account(userId);
    await this.requireManagedWorkspace(actor, await this.find(id));
    const usages = await this.dependencies.workspaces.usages(id);
    if (new UserPolicyService().isAdministrator(actor)) return usages;
    return usages.map((usage) => ({ id: null, name: null, kind: usage.kind }));
  }

  /**
   * Unregisters metadata only; deleting the referenced directory is never supported.
   *
   * @param userId - The signed-in or verified person.
   * @param id - Identifier of the registration.
   * @param revision - The revision the caller last read.
   * @param journal - Records that commit with the removal or not at all.
   */
  public async remove(
    userId: string,
    id: string,
    revision: number,
    journal?: WorkspaceJournal,
  ): Promise<void> {
    await this.account(userId);
    await this.writes.run(async () => {
      const actor = await this.account(userId);
      await this.requireManagedWorkspace(actor, await this.find(id));
      await this.dependencies.workspaces.remove(id, revision, journal, userId);
    });
  }

  /** Retains historical output access after removal while enforcing current project visibility. */
  public async requireProjectAccess(
    userId: string,
    projectId: string,
  ): Promise<void> {
    await this.requireProject(await this.account(userId), projectId);
  }

  private async account(userId: string): Promise<AccountAccess> {
    const snapshot = await this.dependencies.authorization.snapshot();
    const actor = snapshot.accounts.find(
      (account) => account.userId === userId,
    );
    if (!actor?.isActive) throw new AgentError("workspace_access_denied");
    return accountForChannel(actor, this.dependencies.channel ?? "ui");
  }

  /** What every listing starts from: the registrations, and the projects they and the person may touch. */
  private async projectScope(
    actor: AccountAccess,
    userId: string,
  ): Promise<{
    readonly registered: readonly AgentWorkspace[];
    readonly readable: ReadonlyMap<string, Project>;
    readonly manageable: readonly Project[];
    readonly integrations: ReadonlyMap<string, ProjectIntegration>;
  }> {
    const [registered, readable, managedIds] = await Promise.all([
      this.dependencies.workspaces.list(),
      this.readableProjects(actor),
      this.dependencies.projects.findManagedProjectIds(userId),
    ]);
    return {
      registered,
      readable,
      manageable: manageableProjects(actor, readable, managedIds),
      integrations:
        await this.dependencies.projects.findIntegrationsByProjectIds([
          ...readable.keys(),
        ]),
    };
  }

  private async view(
    workspace: AgentWorkspace,
    project: Project | undefined,
    github: WorkspaceGitHub | null,
    canManage: boolean,
  ): Promise<AgentWorkspaceView> {
    return {
      ...(await this.describe(workspace, project, github)),
      revision: workspace.revision,
      canManage,
    };
  }

  private async readableProjects(
    actor: AccountAccess,
  ): Promise<ReadonlyMap<string, Project>> {
    const projects = await this.dependencies.projects.findAll();
    return new Map(
      projects
        .filter((project) => canReadProject(actor, project))
        .map((project): [string, Project] => [project.id, project]),
    );
  }

  private async readableProjectsOf(
    actor: AccountAccess,
    projectIds: readonly string[],
  ): Promise<ReadonlyMap<string, Project>> {
    const projects = await Promise.all(
      [...new Set(projectIds)].map((id) =>
        this.dependencies.projects.findById(id),
      ),
    );
    return new Map(
      projects
        .filter(
          (project): project is Project =>
            project !== null && canReadProject(actor, project),
        )
        .map((project): [string, Project] => [project.id, project]),
    );
  }

  private async find(id: string): Promise<AgentWorkspace> {
    const workspace = (await this.dependencies.workspaces.list()).find(
      (entry) => entry.id === id,
    );
    if (!workspace) throw new AgentError("workspace_not_found");
    return workspace;
  }

  private async authorized(
    userId: string,
    id: string,
    projectId: string | null,
  ): Promise<AgentWorkspace> {
    const actor = await this.account(userId);
    const workspace = (await this.dependencies.workspaces.list()).find(
      (entry) => entry.id === id,
    );
    if (!workspace || (projectId !== null && workspace.projectId !== projectId))
      throw new AgentError("workspace_access_denied");
    await this.requireProject(actor, workspace.projectId);
    return workspace;
  }

  private async requireProject(
    actor: AccountAccess,
    id: string,
  ): Promise<Project> {
    const project = await this.dependencies.projects.findById(id);
    if (!project || !canReadProject(actor, project))
      throw new AgentError("workspace_access_denied");
    return project;
  }

  private async requireGitHub(projectId: string): Promise<WorkspaceGitHub> {
    const github = toGitHub(
      await this.dependencies.projects.findIntegration(projectId),
    );
    if (!github) throw new AgentError("workspace_project_unsupported");
    return github;
  }

  /** A workspace the person cannot see behaves exactly like a missing one. */
  private async requireManagedWorkspace(
    actor: AccountAccess,
    workspace: AgentWorkspace,
  ): Promise<void> {
    const isAdministrator = new UserPolicyService().isAdministrator(actor);
    const project = await this.dependencies.projects.findById(
      workspace.projectId,
    );
    if (!project || !canReadProject(actor, project)) {
      if (isAdministrator) return;
      throw new AgentError("workspace_not_found");
    }
    await this.requireManager(actor, project);
  }

  private async requireManager(
    actor: AccountAccess,
    project: Project,
  ): Promise<void> {
    const isProjectManager = await this.dependencies.projects.isProjectManager(
      project.id,
      actor.userId,
    );
    if (!canManageProject(actor, project, isProjectManager))
      throw new AgentError("workspace_management_denied");
  }

  /** Needs rights on the stored project and on the chosen one, and a GitHub link on the chosen one. */
  private async requireSaveRights(
    userId: string,
    id: string | null,
    proposed: { readonly projectId: string },
  ): Promise<AgentWorkspace | null> {
    const actor = await this.account(userId);
    const previous = id === null ? null : await this.find(id);
    if (previous) await this.requireManagedWorkspace(actor, previous);
    const project = await this.requireProject(actor, proposed.projectId);
    await this.requireManager(actor, project);
    await this.requireGitHub(project.id);
    return previous;
  }

  private async describe(
    workspace: AgentWorkspace,
    project: Project | undefined,
    github: WorkspaceGitHub | null,
  ): Promise<AgentWorkspaceChoice> {
    const reason = await this.unavailability(workspace, project, github);
    return {
      id: workspace.id,
      name: workspace.name,
      path: workspace.path,
      projectId: workspace.projectId,
      projectName: project?.name ?? workspace.projectId,
      github,
      isUsable: reason === null,
      reason,
    };
  }

  private async unavailability(
    workspace: AgentWorkspace,
    project: Project | undefined,
    github: WorkspaceGitHub | null,
  ): Promise<AgentErrorCode | null> {
    if (!project) return "workspace_access_denied";
    if (!github) return "workspace_project_unsupported";
    try {
      await this.dependencies.paths.resolve(workspace);
      return null;
    } catch (error: unknown) {
      logCaughtError("AgentWorkspaceService", error);

      if (!(error instanceof AgentError)) throw error;
      return error.code;
    }
  }
}
