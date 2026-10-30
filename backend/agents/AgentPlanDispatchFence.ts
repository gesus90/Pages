import { AgentError } from "@/backend/error/AgentErrors";
import { AgentPlanCancelledError } from "@/backend/error/AgentPlanCancelledError";
import { AgentPlanPausedError } from "@/backend/error/AgentPlanPausedError";

import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";
import type { RunnerPlanBinding } from "@/definition/RunnerProtocol";

function matchingDispatchStep(
  run: AgentPlanRun,
  binding: RunnerPlanBinding,
): AgentPlanStepResult {
  const step = run.steps.find((entry) => entry.id === binding.stepId);
  const execution = step?.execution;
  if (
    !step ||
    !execution ||
    run.id !== binding.runId ||
    run.planId !== binding.planId ||
    run.planRevision !== binding.planRevision ||
    execution.runId !== binding.runId ||
    execution.planId !== binding.planId ||
    execution.stepId !== binding.stepId ||
    execution.planRevision !== binding.planRevision ||
    execution.attemptId !== binding.attemptId
  )
    throw new AgentError("plan_context_changed");
  return step;
}

/** Refuses stale attempts and distinguishes a durable pre-dispatch Pause or Stop from failure. */
export function requirePlanDispatchFence(
  run: AgentPlanRun,
  binding: RunnerPlanBinding,
): void {
  const step = matchingDispatchStep(run, binding);
  if (run.stopRequested) throw new AgentPlanCancelledError();
  if (run.status === "pausing" || run.status === "paused")
    throw new AgentPlanPausedError();
  if (run.status !== "running" || step.status !== "running")
    throw new AgentError("plan_context_changed");
}
