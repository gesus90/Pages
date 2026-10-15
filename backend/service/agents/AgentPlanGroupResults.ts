import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AgentPlanSnapshot } from "./AgentPlanSnapshot";

/** Derives the outer group status from its children without creating a second scheduler. */
export function withGroupResults(
  run: AgentPlanRun,
  snapshot: AgentPlanSnapshot,
): AgentPlanRun {
  const groups: AgentPlanStepResult[] = (snapshot.groups ?? []).map((group) => {
    const children = group.steps.flatMap((step) =>
      run.steps.filter((entry) => entry.id === step.id),
    );
    const failed = children.find((step) => step.status === "failed");
    const cancelled = children.find((step) => step.status === "cancelled");
    const status = groupStatus({
      children,
      required: group.steps.length,
      isPaused: run.status === "paused",
      hasFailure: Boolean(failed),
      hasCancellation: Boolean(cancelled),
    });
    return {
      id: group.id,
      name: group.name,
      status,
      isBlocked:
        !failed && !cancelled && children.some((step) => step.isBlocked),
      cancellation: cancelled?.cancellation ?? "none",
      failedStepId: failed?.id,
      output: failed ? failed.name : null,
      error: failed?.error ?? null,
    };
  });
  const groupIds = new Set(groups.map((group) => group.id));
  return {
    ...run,
    steps: [...run.steps.filter((step) => !groupIds.has(step.id)), ...groups],
  };
}

function groupStatus(progress: {
  readonly children: readonly AgentPlanStepResult[];
  readonly required: number;
  readonly isPaused: boolean;
  readonly hasFailure: boolean;
  readonly hasCancellation: boolean;
}): AgentPlanStepResult["status"] {
  if (progress.hasFailure) return "failed";
  if (progress.hasCancellation) return "cancelled";
  if (
    progress.children.length === progress.required &&
    progress.children.every((step) => step.status === "succeeded")
  )
    return "succeeded";
  if (progress.isPaused) return "paused";
  if (
    progress.children.some(
      (step) => step.status === "running" || step.status === "succeeded",
    )
  )
    return "running";
  return "waiting";
}
