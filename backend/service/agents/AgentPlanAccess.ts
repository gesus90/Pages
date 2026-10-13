import { AgentError } from "@/backend/error/AgentErrors";

import type { AgentPlanRepository } from "@/backend/database/repositories/agent/AgentPlanRepository";
import type { AgentPlan, AgentPlanView } from "@/definition/AgentPlan";
import type { AgentWorkspaceChoice } from "@/definition/AgentWorkspace";
import type { AgentWorkspaceService } from "./AgentWorkspaceService";
import type { AgentPlanSharing } from "./AgentPlanSharing";
import type { AgentProfileDirectory } from "@/definition/AgentProfile";

/** Ownership controls editing; live project access to the workspace controls every read or run. */
export class AgentPlanAccess {
  private readonly plans: AgentPlanRepository;
  private readonly workspaces: AgentWorkspaceService;
  private readonly sharing: AgentPlanSharing;

  public constructor(
    plans: AgentPlanRepository,
    workspaces: AgentWorkspaceService,
    sharing: AgentPlanSharing,
  ) {
    this.plans = plans;
    this.workspaces = workspaces;
    this.sharing = sharing;
  }

  /** Returns only plans whose workspace is still visible in the plan's project. */
  public async list(userId: string): Promise<readonly AgentPlanView[]> {
    const [plans, workspaces, viewer] = await Promise.all([
      this.plans.list(),
      this.workspaces.choices(userId),
      this.sharing.viewer(userId),
    ]);
    return plans.flatMap((plan) => {
      const workspace = workspaces.find(
        (entry) =>
          entry.id === plan.workspaceId && entry.projectId === plan.projectId,
      );
      if (!workspace || !this.sharing.canRead(plan, viewer)) return [];
      return [this.view(plan, workspace, userId)];
    });
  }

  /** Does not grant an administrator access to another user's private plan. */
  public async require(userId: string, id: string): Promise<AgentPlanView> {
    const plan = (await this.list(userId)).find((entry) => entry.id === id);
    if (!plan) throw new AgentError("plan_access_denied");
    return plan;
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
    workspace: AgentWorkspaceChoice,
    userId: string,
  ): AgentPlanView {
    return {
      ...plan,
      canEdit: plan.ownerId === userId,
      projectName: workspace.projectName,
      github: workspace.github,
    };
  }
}
