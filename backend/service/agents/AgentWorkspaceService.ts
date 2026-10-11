import { randomUUID } from "node:crypto";

import { readWorkspaceInput } from "@/backend/agents/AgentWorkspaceInput";
import { matchesAgentTarget } from "@/backend/auth/AgentProfilePolicy";
import { ProjectPolicyService } from "@/backend/auth/ProjectPolicyService";
import { UserPolicyService } from "@/backend/auth/UserPolicyService";
import { SerialQueue } from "@/backend/concurrency/SerialQueue";
import { AgentError } from "@/backend/error/AgentErrors";

import { requireAgentAdministrator } from "./AgentServiceAccess";

import type { AgentViewer } from "@/backend/auth/AgentProfilePolicy";
import type { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import type { UserGroupRepository } from "@/backend/database/repositories/UserGroupRepository";
import type { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import type { AgentWorkspaceRepository } from "@/backend/database/repositories/agent/AgentWorkspaceRepository";
import type { AccountAccess } from "@/definition/Authorization";
import type { AgentProfileDirectory } from "@/definition/AgentProfile";
import type {
  AgentWorkspace,
  AgentWorkspaceChoice,
  AgentWorkspacePage,
  AgentWorkspaceUsage,
  AgentWorkspaceView,
  ResolvedAgentWorkspace,
  WorkspaceGitHub,
} from "@/definition/AgentWorkspace";
import type { Project } from "@/definition/Project";
import type { AgentWorkspacePath } from "./AgentWorkspacePath";

/** Live account, project and filesystem boundaries; none of these grants imply another. */
export interface AgentWorkspaceDependencies {
  readonly workspaces: AgentWorkspaceRepository;
  readonly authorization: AuthorizationRepository;
  readonly groups: UserGroupRepository;
  readonly projects: ProjectRepository;
  readonly paths: AgentWorkspacePath;
}

function hasWorkspaceUsage(
  workspace: AgentWorkspace,
  viewer: AgentViewer,
): boolean {
  return workspace.targets.some((target) =>
    matchesAgentTarget(target, {
      ...viewer,
      actor: { ...viewer.actor, managedDepartments: [] },
    }),
  );
}

function canReadProject(actor: AccountAccess, project: Project): boolean {
  return new ProjectPolicyService().canAccess(
    actor,
    project.departments.map((department) => department.id),
  );
}

/** Registers existing local directories; management never bypasses execution grants. */
export class AgentWorkspaceService {
  private readonly dependencies: AgentWorkspaceDependencies;
  private readonly writes = new SerialQueue();

  public constructor(dependencies: AgentWorkspaceDependencies) {
    this.dependencies = dependencies;
  }

  /** Lists accessible registrations; only active administrators receive administration metadata. */
  public async page(userId: string): Promise<AgentWorkspacePage> {
    const viewer = await this.viewer(userId);
    const canManage = new UserPolicyService().isAdministrator(viewer.actor);
    const [registered, projects] = await Promise.all([
      this.dependencies.workspaces.list(),
      this.dependencies.projects.findAll(),
    ]);
    const accessible = projects.filter((project) =>
      canReadProject(viewer.actor, project),
    );
    const workspaces: AgentWorkspaceView[] = [];
    for (const workspace of registered) {
      const project = accessible.find(
        (entry) => entry.id === workspace.projectId,
      );
      if (!canManage && (!project || !hasWorkspaceUsage(workspace, viewer)))
        continue;
      workspaces.push(await this.view(workspace, viewer, project));
    }
    return {
      canManage,
      isConfigured: this.dependencies.paths.isConfigured(),
      workspaces,
      projects: canManage
        ? await Promise.all(
            accessible.map(async (project) => ({
              id: project.id,
              name: project.name,
              github: await this.github(project.id),
            })),
          )
        : [],
      directory: canManage
        ? await this.directory(viewer.actor)
        : { persons: [], groups: [], departments: [] },
    };
  }

  /** Selection contains only current usage grants and accessible projects, including explained path failures. */
  public async choices(
    userId: string,
    projectId: string | null = null,
  ): Promise<readonly AgentWorkspaceChoice[]> {
    const viewer = await this.viewer(userId);
    if (projectId !== null) await this.requireProject(viewer.actor, projectId);
    const choices: AgentWorkspaceChoice[] = [];
    for (const workspace of await this.dependencies.workspaces.list()) {
      if (
        !hasWorkspaceUsage(workspace, viewer) ||
        (projectId !== null && workspace.projectId !== projectId)
      )
        continue;
      const project = await this.dependencies.projects.findById(
        workspace.projectId,
      );
      if (!project || !canReadProject(viewer.actor, project)) continue;
      const view = await this.view(workspace, viewer, project);
      choices.push({
        id: view.id,
        name: view.name,
        path: view.path,
        projectId: view.projectId,
        projectName: view.projectName,
        github: view.github,
        isUsable: view.isUsable,
        reason: view.reason,
      });
    }
    return choices;
  }

  /** Reauthorizes IDs before inspecting a path and returns a real working-directory contract. */
  public async resolve(
    userId: string,
    id: string,
    projectId: string | null = null,
  ): Promise<ResolvedAgentWorkspace> {
    const viewer = await this.viewer(userId);
    const workspace = (await this.dependencies.workspaces.list()).find(
      (entry) => entry.id === id,
    );
    if (!workspace || !hasWorkspaceUsage(workspace, viewer))
      throw new AgentError("workspace_access_denied");
    if (projectId !== null && workspace.projectId !== projectId)
      throw new AgentError("workspace_access_denied");
    await this.requireProject(viewer.actor, workspace.projectId);
    return {
      id: workspace.id,
      path: await this.dependencies.paths.resolve(workspace),
      directoryIdentity: workspace.directoryIdentity,
      revision: workspace.revision,
      projectId: workspace.projectId,
      github: await this.github(workspace.projectId),
    };
  }

  /** Stores only a canonical registration and validated grants; no directory content is touched. */
  public async save(
    userId: string,
    id: string | null,
    input: unknown,
  ): Promise<string> {
    requireAgentAdministrator((await this.viewer(userId)).actor);
    const proposed = readWorkspaceInput(input);
    return this.writes.run(async () => {
      const actor = (await this.viewer(userId)).actor;
      requireAgentAdministrator(actor);
      const previous =
        id === null
          ? null
          : (await this.dependencies.workspaces.list()).find(
              (entry) => entry.id === id,
            );
      if (id !== null && !previous) throw new AgentError("workspace_not_found");
      if (previous && proposed.revision !== previous.revision)
        throw new AgentError("workspace_conflict");
      await this.requireProject(actor, proposed.projectId);
      const directory = await this.directory(actor);
      const collections = {
        person: directory.persons,
        group: directory.groups,
        department: directory.departments,
      };
      if (
        proposed.targets.some(
          (target) =>
            !collections[target.kind].some(
              (entry) => entry.id === target.targetId,
            ),
        )
      )
        throw new AgentError("profile_target_invalid");
      const inspected = await this.dependencies.paths.inspect(proposed.path);
      requireAgentAdministrator((await this.viewer(userId)).actor);
      const workspaceId = id ?? randomUUID();
      await this.dependencies.workspaces.save(
        {
          ...proposed,
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

  /** Supplies protected references without revealing them to workspace users. */
  public async usages(
    userId: string,
    id: string,
  ): Promise<readonly AgentWorkspaceUsage[]> {
    requireAgentAdministrator((await this.viewer(userId)).actor);
    return this.dependencies.workspaces.usages(id);
  }

  /** Unregisters metadata only; deleting the referenced directory is never supported. */
  public async remove(
    userId: string,
    id: string,
    revision: number,
  ): Promise<void> {
    requireAgentAdministrator((await this.viewer(userId)).actor);
    await this.writes.run(async () => {
      requireAgentAdministrator((await this.viewer(userId)).actor);
      await this.dependencies.workspaces.remove(id, revision);
    });
  }

  private async viewer(userId: string): Promise<AgentViewer> {
    const [snapshot, groupIds] = await Promise.all([
      this.dependencies.authorization.snapshot(),
      this.dependencies.groups.findIdsByMember(userId),
    ]);
    const actor = snapshot.accounts.find(
      (account) => account.userId === userId,
    );
    if (!actor?.isActive) throw new AgentError("workspace_access_denied");
    return { actor, groupIds };
  }

  private async directory(
    actor: AccountAccess,
  ): Promise<AgentProfileDirectory> {
    requireAgentAdministrator(actor);
    const [snapshot, groups] = await Promise.all([
      this.dependencies.authorization.snapshot(),
      this.dependencies.groups.findAll(),
    ]);
    return {
      persons: snapshot.accounts
        .filter((account) => account.isActive)
        .map((account) => ({
          id: account.userId,
          name:
            `${account.firstName} ${account.lastName}`.trim() || account.userId,
        })),
      groups: groups.map((group) => ({ id: group.id, name: group.name })),
      departments: snapshot.departments,
    };
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

  private async github(projectId: string): Promise<WorkspaceGitHub | null> {
    const integration =
      await this.dependencies.projects.findIntegration(projectId);
    return integration?.repoUrl
      ? { repoUrl: integration.repoUrl, repoName: integration.repoName }
      : null;
  }

  private async view(
    workspace: AgentWorkspace,
    viewer: AgentViewer,
    project: Project | undefined,
  ): Promise<AgentWorkspaceView> {
    let reason: AgentWorkspaceView["reason"] = null;
    if (!project || !hasWorkspaceUsage(workspace, viewer))
      reason = "workspace_access_denied";
    else {
      try {
        await this.dependencies.paths.resolve(workspace);
      } catch (error: unknown) {
        if (!(error instanceof AgentError)) throw error;
        reason = error.code;
      }
    }
    const canManage = new UserPolicyService().isAdministrator(viewer.actor);
    return {
      id: workspace.id,
      name: workspace.name,
      path: workspace.path,
      projectId: workspace.projectId,
      projectName: project?.name ?? workspace.projectId,
      github: project ? await this.github(workspace.projectId) : null,
      isUsable: reason === null,
      reason,
      revision: workspace.revision,
      canManage,
      targets: canManage ? workspace.targets : [],
    };
  }
}
