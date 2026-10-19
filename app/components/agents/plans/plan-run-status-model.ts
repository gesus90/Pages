import { isActivePlanRun } from "@/definition/AgentPlanRunState";

import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";

/** Counts the executed revision's flow steps once, omitting derived group summaries. */
export function statusSteps(
  run: AgentPlanRun | null,
): readonly AgentPlanStepResult[] {
  const groups = new Set(
    run?.steps.flatMap((step) => (step.groupId ? [step.groupId] : [])),
  );
  return run?.steps.filter((step) => !groups.has(step.id)) ?? [];
}

/** Uses the first active frontier member in persisted order, then the recorded pause frontier. */
export function statusAnchor(
  run: AgentPlanRun | null,
  steps: readonly AgentPlanStepResult[],
): string | null {
  if (!run) return null;
  if (isActivePlanRun(run.status)) {
    return (
      steps.find((step) => step.status === "running")?.id ??
      steps.find((step) => run.pauseBoundary?.frontierStepIds.includes(step.id))
        ?.id ??
      steps.find(
        (step) =>
          step.isBlocked ||
          step.status === "paused" ||
          step.status === "waiting",
      )?.id ??
      steps.at(-1)?.id ??
      null
    );
  }
  return steps.at(-1)?.id ?? null;
}

/** Terminal runs never retain an orange active indicator from an interrupted session. */
export function statusTone(
  step: AgentPlanStepResult,
  run: AgentPlanRun,
): string {
  if (step.isBlocked || step.status === "failed")
    return "bg-destructive text-primary-foreground hover:bg-destructive";
  if (step.status === "succeeded")
    return "bg-plan-progress-done bg-linear-to-br from-plan-progress-shade/50 to-plan-progress-shade/35 text-plan-progress-label hover:bg-plan-progress-done";
  if (step.status === "running" && isActivePlanRun(run.status))
    return "bg-primary text-plan-progress-active-label hover:bg-primary";
  return "bg-plan-progress-waiting bg-linear-to-br from-plan-progress-surface/10 to-plan-progress-surface/25 text-foreground hover:bg-plan-progress-waiting";
}

/** Formats measured wall time, including pauses, without estimating a finish. */
export function elapsedTime(
  start: string | null | undefined,
  end: string | null | undefined,
): string {
  if (!start || !end) return "—";
  const seconds = Math.floor((Date.parse(end) - Date.parse(start)) / 1000);
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
