import { planExecutionIssues } from "@/definition/AgentPlanGraph";
import { AgentError } from "@/backend/error/AgentErrors";
import { planControl } from "./AgentPlanControl";
import type { AgentPlanControl } from "@/definition/AgentPlanControl";
import type { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";
import type { AgentPlanAccess } from "./AgentPlanAccess";
import type { AgentProfileService } from "./AgentProfileService";
import type { AgentPlanPreparation } from "./AgentPlanPreparation";
import type { AgentPlan } from "@/definition/AgentPlan";

interface ControlDependencies {
  readonly access: Pick<AgentPlanAccess, "require">;
  readonly profiles: Pick<AgentProfileService, "catalog">;
  readonly preparation?: Pick<AgentPlanPreparation, "validateScripts">;
  readonly runs: Pick<
    AgentPlanRunRepository,
    "latest" | "hasReservation" | "resources"
  >;
}
/** Server-side action availability, including current graph and execution-context refusals. */
export class AgentPlanControlService {
  private readonly dependencies: ControlDependencies;
  public constructor(dependencies: ControlDependencies) {
    this.dependencies = dependencies;
  }
  /** Shared readers see state without prompts, results or session capabilities. */
  public async read(userId: string, planId: string): Promise<AgentPlanControl> {
    const plan = await this.dependencies.access.require(userId, planId);
    const run = await this.dependencies.runs.latest(planId);
    const control = planControl(plan, run, {
      userId,
      hasReservation: run
        ? await this.dependencies.runs.hasReservation(run.id)
        : false,
    });
    if (!plan.canEdit) return control;
    if (
      run &&
      (run.status === "running" ||
        run.status === "pausing" ||
        run.status === "stopping")
    )
      return control;
    const issues = planExecutionIssues(
      plan,
      await this.dependencies.profiles.catalog(userId, plan.projectId),
    );
    let issue = (await this.executionIssue(userId, plan)) ?? control.issue;
    if (run?.status === "paused") {
      const resources = await this.dependencies.runs.resources(run.id);
      if (
        resources.projectId !== plan.projectId ||
        resources.workspaceIds[0] !== plan.workspaceId
      )
        issue = "plan_context_changed";
    }
    if (issues.length === 0 && issue === control.issue) return control;
    return {
      ...control,
      issues,
      issue: issue ?? "plan_invalid",
      canPlay: false,
      canResume: false,
    };
  }

  private async executionIssue(
    userId: string,
    plan: AgentPlan,
  ): Promise<string | null> {
    try {
      await this.dependencies.preparation?.validateScripts(userId, plan);
      return null;
    } catch (error: unknown) {
      if (!(error instanceof AgentError)) throw error;
      return error.code;
    }
  }
}
