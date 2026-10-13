import { randomUUID } from "node:crypto";

import { readWorkspaceInput } from "@/backend/agents/AgentWorkspaceInput";
import { ProjectPolicyService } from "@/backend/auth/ProjectPolicyService";
import { UserPolicyService } from "@/backend/auth/UserPolicyService";
import { SerialQueue } from "@/backend/concurrency/SerialQueue";
import { AgentError } from "@/backend/error/AgentErrors";

import type { AgentErrorCode } from "@/backend/error/AgentErrors";
import type { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import type { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import type { AgentWorkspaceRepository } from "@/backend/database/repositories/agent/AgentWorkspaceRepository";
import type { AccountAccess } from "@/definition/Authorization";
import type {
  AgentWorkspace,
  AgentWorkspaceChoice,
  AgentWorkspacePage,
  AgentWorkspaceUsage,
  AgentWorkspaceView,
  ResolvedAgentWorkspace,
  WorkspaceGitHub,
} from "@/definition/AgentWorkspace";
import type { Project, ProjectIntegration } from "@/definition/Project";
import type { AgentWorkspacePath } from "./AgentWorkspacePath";

/** Live account, project and filesystem boundaries; none of these grants imply another. */
export interface AgentWorkspaceDependencies {
  readonly workspaces: AgentWorkspaceRepository;
  readonly authorization: AuthorizationRepository;
  readonly projects: ProjectRepository;
  readonly paths: AgentWorkspacePath;
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

/**
 * Registers existing local directories for projects with a GitHub link.
 *
 * @remarks
 * Everyone who can open the project sees and uses its workspaces. Only
 * administrators and the project's managers register, change or remove them.
 */
export class AgentWorkspaceService {
  private readonly dependencies: AgentWorkspaceDependencies;
  private readonly writes = new SerialQueue();

  public constructor(dependencies: AgentWorkspaceDependencies) {
    this.dependencies = dependencies;
  }

  /** Lists the workspaces of accessible projects, with management hints and the projects a person may assign. */
  public async page(userId: string): Promise<AgentWorkspacePage> {
    const actor = await this.account(userId);
    const isAdministrator = new UserPolicyService().isAdministrator(actor);
    const [registered, readable, managedIds] = await Promise.all([
      this.dependencies.workspaces.list(),
      this.readableProjects(actor),
      this.dependencies.projects.findManagedProjectIds(userId),
    ]);
    const managed = new Set(managedIds);
    const manageable = [...readable.values()].filter((project) =>
      canManageProject(actor, project, managed.has(project.id)),
    );
    const manageableIds = new Set(manageable.map((project) => project.id));
    const integrations =
      await this.dependencies.projects.findIntegrationsByProjectIds([
        ...readable.keys(),
      ]);
    // Only administrators see a registration whose project nobody can open any more, so they can clean it up.
    const visible = registered.filter(
      (workspace) => isAdministrator || readable.has(workspace.projectId),
    );
    const workspaces = await Promise.all(
      visible.map(async (workspace): Promise<AgentWorkspaceView> => ({
        ...(await this.describe(
          workspace,
          readable.get(workspace.projectId),
          toGitHub(integrations.get(workspace.projectId)),
        )),
        revision: workspace.revision,
        canManage: isAdministrator || manageableIds.has(workspace.projectId),
      })),
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

  /** Stores only a canonical registration for a managed project with a GitHub link; no directory content is touched. */
  public async save(
    userId: string,
    id: string | null,
    input: unknown,
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

  /** Unregisters metadata only; deleting the referenced directory is never supported. */
  public async remove(
    userId: string,
    id: string,
    revision: number,
  ): Promise<void> {
    await this.account(userId);
    await this.writes.run(async () => {
      const actor = await this.account(userId);
      await this.requireManagedWorkspace(actor, await this.find(id));
      await this.dependencies.workspaces.remove(id, revision);
    });
  }

  private async account(userId: string): Promise<AccountAccess> {
    const snapshot = await this.dependencies.authorization.snapshot();
    const actor = snapshot.accounts.find(
      (account) => account.userId === userId,
    );
    if (!actor?.isActive) throw new AgentError("workspace_access_denied");
    return actor;
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
      if (!(error instanceof AgentError)) throw error;
      return error.code;
    }
  }
}
