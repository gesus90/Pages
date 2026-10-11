import { AgentError } from "@/backend/error/AgentErrors";

import type { AgentPlanRepository } from "@/backend/database/repositories/agent/AgentPlanRepository";
import type { AgentPlan, AgentPlanView } from "@/definition/AgentPlan";
import type { AgentWorkspaceChoice } from "@/definition/AgentWorkspace";
import type { AgentWorkspaceService } from "./AgentWorkspaceService";

/** Ownership controls editing; live workspace usage and project access control every read or run. */
export class AgentPlanAccess {
  private readonly plans: AgentPlanRepository;
  private readonly workspaces: AgentWorkspaceService;

  public constructor(
    plans: AgentPlanRepository,
    workspaces: AgentWorkspaceService,
  ) {
    this.plans = plans;
    this.workspaces = workspaces;
  }

  /** Returns only plans whose current workspace project and usage grants still agree. */
  public async list(userId: string): Promise<readonly AgentPlanView[]> {
    const [plans, workspaces] = await Promise.all([
      this.plans.list(),
      this.workspaces.choices(userId),
    ]);
    return plans.flatMap((plan) => {
      const workspace = workspaces.find(
        (entry) =>
          entry.id === plan.workspaceId && entry.projectId === plan.projectId,
      );
      if (!workspace || (plan.usage === "private" && plan.ownerId !== userId))
        return [];
      return [this.view(plan, workspace, userId)];
    });
  }

  /** Does not grant an administrator access to another user's private plan. */
  public async require(userId: string, id: string): Promise<AgentPlanView> {
    const plan = (await this.list(userId)).find((entry) => entry.id === id);
    if (!plan) throw new AgentError("plan_access_denied");
    return plan;
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
