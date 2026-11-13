import { endedPlanRun } from "./AgentPlanRunState";

import type {
  AgentPlanRun,
  AgentPlanStepResult,
  AgentPlanStepStatus,
} from "@/definition/AgentPlan";
import type {
  AgentPlanLoopIteration,
  AgentPlanLoopRun,
} from "@/definition/AgentPlanLoopRun";

function cancelUnstartedStep(step: AgentPlanStepResult): AgentPlanStepResult {
  if (step.status !== "waiting" && step.status !== "paused") return step;
  return {
    ...step,
    status: "cancelled",
    cancellation: "not_started",
    isBlocked: false,
    blockedByStepId: undefined,
  };
}

function isOpenLoopState(status: AgentPlanStepStatus): boolean {
  return status === "waiting" || status === "paused" || status === "running";
}

function cancelIteration(
  iteration: AgentPlanLoopIteration,
  code: string,
  endedAt: string,
): AgentPlanLoopIteration {
  if (!isOpenLoopState(iteration.status)) return iteration;
  return {
    ...iteration,
    status: "cancelled",
    error: code,
    endedAt,
    nodes: iteration.nodes.map(cancelUnstartedStep),
  };
}

function cancelLoop(
  loop: AgentPlanLoopRun,
  code: string,
  endedAt: string,
): AgentPlanLoopRun {
  if (!isOpenLoopState(loop.status)) return loop;
  return {
    ...loop,
    status: "cancelled",
    error: code,
    endedAt,
    iterations: loop.iterations.map((iteration) =>
      cancelIteration(iteration, code, endedAt),
    ),
  };
}

/**
 * Closes a rejected start, including pending work carried into recovered loops.
 * The caller must first verify that no engine or running step owns execution.
 */
export function failedPlanStart(run: AgentPlanRun, code: string): AgentPlanRun {
  const endedAt = run.endedAt ?? new Date().toISOString();
  return {
    ...endedPlanRun({ ...run, endedAt }, "failed"),
    startError: code,
    steps: run.steps.map(cancelUnstartedStep),
    ...(run.loops
      ? { loops: run.loops.map((loop) => cancelLoop(loop, code, endedAt)) }
      : {}),
  };
}
