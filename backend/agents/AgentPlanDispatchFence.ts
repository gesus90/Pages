import { allPlanRunResults } from "@/definition/AgentPlanLoopResults";
import { AgentError } from "@/backend/error/AgentErrors";
import { AgentPlanCancelledError } from "@/backend/error/AgentPlanCancelledError";
import { AgentPlanPausedError } from "@/backend/error/AgentPlanPausedError";

import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";
import type { RunnerPlanBinding } from "@/definition/RunnerProtocol";

function matchesRunContext(
  run: AgentPlanRun,
  binding: RunnerPlanBinding,
): boolean {
  return (
    run.id === binding.runId &&
    run.planId === binding.planId &&
    run.planRevision === binding.planRevision
  );
}

function matchesExecution(
  execution: NonNullable<AgentPlanStepResult["execution"]>,
  binding: RunnerPlanBinding,
): boolean {
  return (
    execution.runId === binding.runId &&
    execution.planId === binding.planId &&
    execution.stepId === binding.stepId &&
    execution.planRevision === binding.planRevision &&
    execution.attemptId === binding.attemptId
  );
}

function matchingDispatchStep(
  run: AgentPlanRun,
  binding: RunnerPlanBinding,
): AgentPlanStepResult {
  if (binding.managed) {
    const owner = allPlanRunResults(run).find(
      (entry) => entry.id === (binding.ownerStepId ?? binding.stepId),
    );
    if (!owner || !matchesRunContext(run, binding))
      throw new AgentError("plan_context_changed");
    return owner;
  }
  const step = run.steps.find((entry) => entry.id === binding.stepId);
  const execution = step?.execution;
  if (
    !step ||
    !execution ||
    !matchesRunContext(run, binding) ||
    !matchesExecution(execution, binding)
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
  const isRetainedInstruction =
    binding.isInstruction &&
    step.session?.endedAt === null &&
    step.session.sessionId;
  if (
    run.status !== "running" ||
    (step.status !== "running" && !isRetainedInstruction)
  )
    throw new AgentError("plan_context_changed");
}
