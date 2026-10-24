import { AgentError } from "@/backend/error/AgentErrors";

import type { AgentPlanRepository } from "@/backend/database/repositories/agent/AgentPlanRepository";
import type { AgentPlan, AgentPlanView } from "@/definition/AgentPlan";
import type { AgentWorkspaceChoice } from "@/definition/AgentWorkspace";
import type { AgentWorkspaceService } from "./AgentWorkspaceService";
import type { AgentPlanSharing } from "./AgentPlanSharing";
import type { AgentProfileDirectory } from "@/definition/AgentProfile";
import type {
  AgentPlanWorkspaces,
  PlanWorkspaceProject,
} from "./AgentPlanWorkspaces";

/** The project and the departments that decide which shared objects a person works with. */
export interface AgentPlanTeam {
  /** The project of the workspace the person works in; `null` without one. */
  readonly projectId: string | null;
  /** The departments the person is a member or leader of now, each once. */
  readonly departmentIds: readonly string[];
  /** The department an object the person creates belongs to; `null` for none or several. */
  readonly departmentId: string | null;
}

/**
 * Decides who sees and changes a plan, on every call.
 *
 * @remarks
 * Live project access to the workspace controls every read or run. The owner
 * and the members and leaders of the plan's department, who also have that
 * project access, edit and run it; everybody else the plan is shared with only reads it.
 */
export class AgentPlanAccess {
  private readonly plans: AgentPlanRepository;
  private readonly workspaces: AgentWorkspaceService;
  private readonly sharing: AgentPlanSharing;
  private readonly catalog: AgentPlanWorkspaces | undefined;

  public constructor(
    plans: AgentPlanRepository,
    workspaces: AgentWorkspaceService,
    sharing: AgentPlanSharing,
    catalog?: AgentPlanWorkspaces,
  ) {
    this.plans = plans;
    this.workspaces = workspaces;
    this.sharing = sharing;
    this.catalog = catalog;
  }

  /** Keeps orphaned plans repairable under their existing project and sharing rights. */
  public async list(userId: string): Promise<readonly AgentPlanView[]> {
    const [plans, workspaces, viewer] = await Promise.all([
      this.plans.list(),
      this.catalog?.choices(userId) ?? this.workspaces.choices(userId),
      this.sharing.viewer(userId),
    ]);
    const [registered, projects] = await Promise.all([
      this.catalog?.registeredIds(),
      this.catalog?.projects(viewer.actor),
    ]);
    return plans.flatMap((plan) => {
      const workspace = workspaces.find(
        (entry) =>
          entry.id === plan.workspaceId && entry.projectId === plan.projectId,
      );
      if (!this.sharing.canRead(plan, viewer)) return [];
      if (workspace)
        return [this.view(plan, workspace, this.sharing.canEdit(plan, viewer))];
      const project = projects?.get(plan.projectId);
      if (!project || !registered || registered.has(plan.workspaceId))
        return [];
      return [
        {
          ...this.view(plan, project, this.sharing.canEdit(plan, viewer)),
          isWorkspaceMissing: true,
        },
      ];
    });
  }

  /** Does not grant an administrator access to another user's private plan. */
  public async require(userId: string, id: string): Promise<AgentPlanView> {
    const plan = (await this.list(userId)).find((entry) => entry.id === id);
    if (!plan) throw new AgentError("plan_access_denied");
    return plan;
  }

  /**
   * Resolves the department an object of the person belongs to and the project they work in.
   *
   * @param userId - The signed-in person; an inactive account is refused.
   * @param workspaceId - The workspace being worked in, or `null` without one.
   * @throws {AgentError} `plan_access_denied` for a workspace outside the
   * projects the person can open.
   */
  public async team(
    userId: string,
    workspaceId: string | null,
  ): Promise<AgentPlanTeam> {
    const viewer = await this.sharing.viewer(userId);
    const workspace =
      workspaceId === null
        ? null
        : (
            await (this.catalog?.choices(userId) ??
              this.workspaces.choices(userId))
          ).find((entry) => entry.id === workspaceId);
    if (workspace === undefined) throw new AgentError("plan_access_denied");
    return {
      projectId: workspace?.projectId ?? null,
      departmentIds: viewer.actor.departments,
      departmentId: this.sharing.teamDepartment(viewer),
    };
  }

  /** Supplies sharing choices only to active accounts. */
  public async directory(userId: string): Promise<AgentProfileDirectory> {
    await this.sharing.viewer(userId);
    return this.sharing.directory();
  }

  /** Validates sharing identifiers before persisting a plan. */
  public async validateSharing(plan: AgentPlan): Promise<void> {
    await this.sharing.validate(plan);
  }

  private view(
    plan: AgentPlan,
    workspace:
      | Pick<AgentWorkspaceChoice, "projectName" | "github">
      | PlanWorkspaceProject,
    canEdit: boolean,
  ): AgentPlanView {
    return {
      ...plan,
      canEdit,
      projectName: workspace.projectName,
      github: workspace.github,
    };
  }
}
