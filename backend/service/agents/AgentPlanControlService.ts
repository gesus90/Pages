import { planExecutionIssues } from "@/definition/AgentPlanGraph";
import { AgentError } from "@/backend/error/AgentErrors";
import { AgentExecutionError } from "@/backend/error/AgentExecutionErrors";
import { AgentPlanValidationError } from "@/backend/error/AgentPlanValidationError";
import { isSamePlanTarget } from "@/definition/AgentPlanTarget";
import { planControl } from "./AgentPlanControl";
import type { AgentPlanIssue } from "@/definition/AgentPlanGraph";
import type { AgentPlanControl } from "@/definition/AgentPlanControl";
import type { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";
import type { AgentPlanAccess } from "./AgentPlanAccess";
import type { AgentProfileService } from "./AgentProfileService";
import type { AgentPlanPreparation } from "./AgentPlanPreparation";
import type { AgentPlan, AgentPlanRun } from "@/definition/AgentPlan";

interface ControlDependencies {
  readonly access: Pick<AgentPlanAccess, "require">;
  readonly profiles: Pick<AgentProfileService, "catalog">;
  readonly preparation?: Pick<AgentPlanPreparation, "prepare">;
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
    const issues = [
      ...planExecutionIssues(
        plan,
        await this.dependencies.profiles.catalog(userId, plan.projectId),
      ),
    ];
    let issue =
      (await this.executionIssue(userId, plan, issues)) ?? control.issue;
    if (run?.status === "paused" && (await this.hasChangedContext(run, plan)))
      issue = "plan_context_changed";
    if (issues.length === 0 && issue === control.issue) return control;
    return {
      ...control,
      issues,
      issue: issue ?? "plan_invalid",
      canPlay: false,
      canResume: false,
    };
  }

  /** A paused run keeps its project, workspace and plan target; another one in the plan blocks its continuation. */
  private async hasChangedContext(
    run: AgentPlanRun,
    plan: AgentPlan,
  ): Promise<boolean> {
    const resources = await this.dependencies.runs.resources(run.id);
    return (
      resources.projectId !== plan.projectId ||
      resources.workspaceIds[0] !== plan.workspaceId ||
      !isSamePlanTarget(resources.executionTarget, plan.executionTarget)
    );
  }

  private async executionIssue(
    userId: string,
    plan: AgentPlan,
    issues: AgentPlanIssue[],
  ): Promise<string | null> {
    try {
      await this.dependencies.preparation?.prepare(userId, plan);
      return null;
    } catch (error: unknown) {
      if (error instanceof AgentPlanValidationError)
        issues.push(...error.issues);
      if (error instanceof AgentExecutionError) return error.code;
      if (!(error instanceof AgentError)) throw error;
      return error.code;
    }
  }
}
