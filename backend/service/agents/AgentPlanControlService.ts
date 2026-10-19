import { planExecutionIssues } from "@/definition/AgentPlanGraph";

import { planControl } from "./AgentPlanControl";

import type { AgentPlanControl } from "@/definition/AgentPlanControl";
import type { AgentPlanIssue } from "@/definition/AgentPlanGraph";
import type { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";
import type { AgentPlanAccess } from "./AgentPlanAccess";
import type { AgentProfileService } from "./AgentProfileService";

interface ControlDependencies {
  readonly access: Pick<AgentPlanAccess, "require">;
  readonly profiles: Pick<AgentProfileService, "catalog">;
  readonly runs: Pick<
    AgentPlanRunRepository,
    "latest" | "hasReservation" | "resources"
  >;
}
/**
 * The reason a plan does not start: a script, which Pages cannot run yet, is
 * named as such; every other finding of the graph check as an invalid plan.
 */
function issueCode(issues: readonly AgentPlanIssue[]): string {
  return issues.some((issue) => issue.reason === "scriptUnavailable")
    ? "plan_script_unavailable"
    : "plan_invalid";
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
    let issue = control.issue;
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
      issue: issue ?? issueCode(issues),
      canPlay: false,
      canResume: false,
    };
  }
}
