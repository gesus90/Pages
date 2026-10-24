import { ProjectPolicyService } from "@/backend/auth/ProjectPolicyService";
import { AgentError } from "@/backend/error/AgentErrors";

import type { AgentPlanWorkspaceRepository } from "@/backend/database/repositories/agent/AgentPlanWorkspaceRepository";
import type { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import type { RemoteWorkspaceService } from "@/backend/service/remote/RemoteWorkspaceService";
import type { AgentPlanInput } from "@/definition/AgentPlan";
import type { AccountAccess } from "@/definition/Authorization";
import type {
  AgentWorkspaceChoice,
  WorkspaceGitHub,
} from "@/definition/AgentWorkspace";
import type { AgentWorkspaceService } from "./AgentWorkspaceService";

interface PlanWorkspaceDependencies {
  readonly local: AgentWorkspaceService;
  readonly remote: RemoteWorkspaceService;
  readonly registrations: AgentPlanWorkspaceRepository;
  readonly projects: ProjectRepository;
}

/** Project metadata for repairing a removed registration without granting access to hidden workspaces. */
export interface PlanWorkspaceProject {
  readonly projectName: string;
  readonly github: WorkspaceGitHub | null;
}

/** Unifies plan context only; remote paths are never passed to local execution. */
export class AgentPlanWorkspaces {
  private readonly dependencies: PlanWorkspaceDependencies;

  public constructor(dependencies: PlanWorkspaceDependencies) {
    this.dependencies = dependencies;
  }

  /** Reads registrations afresh, independently of a runner's transient catalogs. */
  public async choices(
    userId: string,
  ): Promise<readonly AgentWorkspaceChoice[]> {
    const [local, remote] = await Promise.all([
      this.dependencies.local.choices(userId),
      this.dependencies.remote.list(userId),
    ]);
    return [
      ...local,
      ...remote
        .filter((workspace) => workspace.canOpenConsole)
        .map((workspace): AgentWorkspaceChoice => ({
          id: workspace.id,
          kind: "remote",
          name: workspace.name,
          path: workspace.path,
          projectId: workspace.projectId,
          projectName: workspace.projectName,
          github: workspace.github,
          isUsable: workspace.isUsable,
          reason: workspace.isUsable ? null : "plan_remote_unavailable",
        })),
    ];
  }

  /** Validates the plan's context without requiring an unrelated local directory. */
  public async resolve(
    userId: string,
    plan: Pick<AgentPlanInput, "workspaceId" | "executionTarget">,
  ): Promise<
    { readonly projectId: string } & Pick<AgentPlanInput, "executionTarget">
  > {
    const workspace = (await this.choices(userId)).find(
      (entry) => entry.id === plan.workspaceId,
    );
    if (!workspace) throw new AgentError("workspace_not_found");
    if (workspace.kind !== "remote")
      return this.dependencies.local.resolve(userId, workspace.id);
    if (
      plan.executionTarget !== undefined &&
      (plan.executionTarget.kind !== "remote" ||
        plan.executionTarget.workspaceId !== workspace.id)
    )
      throw new AgentError("plan_context_changed");
    await this.dependencies.remote.requireConsole(userId, workspace.id);
    if (!workspace.isUsable) throw new AgentError("plan_remote_unavailable");
    return {
      projectId: workspace.projectId,
      executionTarget: { kind: "remote", workspaceId: workspace.id },
    };
  }

  /** Reauthorizes history without requiring an online runner or a usable directory. */
  public async requireAccess(
    userId: string,
    id: string,
    projectId: string,
  ): Promise<void> {
    const workspace = (await this.choices(userId)).find(
      (entry) => entry.id === id && entry.projectId === projectId,
    );
    if (!workspace) throw new AgentError("plan_access_denied");
  }

  /** Keeps removed registrations distinct from existing ones the viewer cannot see. */
  public async registeredIds(): Promise<ReadonlySet<string>> {
    return this.dependencies.registrations.registeredIds();
  }

  /** Current project rights still apply to plans whose registration was removed. */
  public async projects(
    actor: AccountAccess,
  ): Promise<ReadonlyMap<string, PlanWorkspaceProject>> {
    const policy = new ProjectPolicyService();
    const projects = (await this.dependencies.projects.findAll()).filter(
      (project) =>
        policy.canAccess(
          actor,
          project.departments.map((department) => department.id),
        ),
    );
    const integrations =
      await this.dependencies.projects.findIntegrationsByProjectIds(
        projects.map((project) => project.id),
      );
    return new Map(
      projects.map((project) => {
        const integration = integrations.get(project.id);
        return [
          project.id,
          {
            projectName: project.name,
            github: integration?.repoUrl
              ? { repoUrl: integration.repoUrl, repoName: integration.repoName }
              : null,
          },
        ];
      }),
    );
  }
}
