import { planGroupProgress } from "@/definition/AgentPlanGroupProgress";

import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";
import type { PlanGroupState } from "@/definition/AgentPlanGroupProgress";
import type { AgentPlanSnapshot } from "./AgentPlanSnapshot";

const STEP_STATUS: Record<PlanGroupState, AgentPlanStepResult["status"]> = {
  ready: "waiting",
  running: "running",
  pausing: "running",
  paused: "paused",
  stopping: "running",
  stopped: "cancelled",
  completed: "succeeded",
  blocked: "waiting",
  failed: "failed",
  unavailable: "waiting",
};

/** Derives read-only group summaries from real member results without scheduling the frame. */
export function withGroupResults(
  run: AgentPlanRun,
  snapshot: AgentPlanSnapshot,
): AgentPlanRun {
  const groups: AgentPlanStepResult[] = (snapshot.groups ?? []).map((group) => {
    const children = run.steps.filter((step) =>
      group.steps.some((member) => member.id === step.id),
    );
    const failed = children.find((step) => step.status === "failed");
    const cancelled = children.find((step) => step.status === "cancelled");
    const progress = planGroupProgress(group, run);
    return {
      id: group.id,
      name: group.name,
      status: STEP_STATUS[progress.state],
      isBlocked:
        progress.state === "blocked" || progress.state === "unavailable",
      cancellation: cancelled?.cancellation ?? "none",
      failedStepId: failed?.id,
      output: failed?.name ?? null,
      error: progress.error,
    };
  });
  const ids = new Set(groups.map((group) => group.id));
  return {
    ...run,
    steps: [...run.steps.filter((step) => !ids.has(step.id)), ...groups],
  };
}
