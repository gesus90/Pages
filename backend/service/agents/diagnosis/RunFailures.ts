import { allPlanRunResults } from "@/definition/AgentPlanLoopResults";

import { classifyAgentRunError } from "./AgentRunErrorClassifier";

import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AgentRunErrorClassification } from "@/definition/AgentRunDiagnosis";

/** One failed step of a run with its fixed error class. */
export interface RunFailure extends AgentRunErrorClassification {
  readonly stepId: string;
  readonly stepLabel: string;
  readonly loopId: string | null;
  readonly iteration: number | null;
  readonly attemptId: string | null;
  readonly occurredAt: string;
}

/** The failure of a whole run: the first failed step, or the run's own cause. */
export interface RunFailureSummary extends AgentRunErrorClassification {
  readonly failedStepId: string | null;
}

/** When a step started and ended, from whichever record it left. */
export function stepTimes(step: AgentPlanStepResult): {
  readonly startedAt: string | null;
  readonly endedAt: string | null;
} {
  return {
    startedAt:
      step.script?.startedAt ??
      step.session?.startedAt ??
      step.remote?.startedAt ??
      null,
    endedAt:
      step.script?.endedAt ??
      step.session?.endedAt ??
      step.remote?.endedAt ??
      null,
  };
}

/** The attempt a step result belongs to, as far as its records name one. */
export function stepAttemptId(step: AgentPlanStepResult): string | null {
  return (
    step.session?.attemptId ??
    step.script?.attemptId ??
    step.execution?.attemptId ??
    null
  );
}

function failureOf(
  run: AgentPlanRun,
  step: AgentPlanStepResult,
  place: { readonly loopId: string | null; readonly iteration: number | null },
): RunFailure {
  const retryEnd = step.session?.retry?.attempts.at(-1)?.endedAt;
  return {
    ...classifyAgentRunError(step.error),
    stepId: step.id,
    stepLabel: step.name,
    ...place,
    attemptId: stepAttemptId(step),
    occurredAt:
      stepTimes(step).endedAt ?? retryEnd ?? run.endedAt ?? run.startedAt,
  };
}

/**
 * Lists the failed steps of a run, loop members included, oldest first.
 *
 * @param run - The stored run; its content may be hidden, the codes stay.
 * @remarks
 * A loop that failed because one of its members failed is not counted a
 * second time.
 */
export function extractRunFailures(run: AgentPlanRun): readonly RunFailure[] {
  const loops = run.loops ?? [];
  const failedMemberLoops = new Set(
    loops
      .filter((loop) =>
        loop.iterations.some((iteration) =>
          iteration.nodes.some((node) => node.status === "failed"),
        ),
      )
      .map((loop) => loop.id),
  );
  const outer = run.steps
    .filter(
      (step) => step.status === "failed" && !failedMemberLoops.has(step.id),
    )
    .map((step) => failureOf(run, step, { loopId: null, iteration: null }));
  const members = loops.flatMap((loop) =>
    loop.iterations.flatMap((iteration) =>
      iteration.nodes
        .filter((node) => node.status === "failed")
        .map((node) =>
          failureOf(run, node, {
            loopId: loop.id,
            iteration: iteration.number,
          }),
        ),
    ),
  );
  return [...outer, ...members].sort((left, right) =>
    left.occurredAt.localeCompare(right.occurredAt),
  );
}

/**
 * Names why a run failed.
 *
 * @param run - The stored run.
 * @param failures - Its failed steps, oldest first.
 * @returns `null` for a run that did not fail and has no failed step.
 */
export function summarizeRunFailure(
  run: AgentPlanRun,
  failures: readonly RunFailure[],
): RunFailureSummary | null {
  const first = failures.at(0);
  if (first) return { ...first, failedStepId: first.stepId };
  if (run.status !== "failed" && run.status !== "work_done_closeout_open")
    return null;
  const code =
    run.recovery?.state === "interrupted"
      ? "plan_interrupted"
      : (run.controlError ?? null);
  return { ...classifyAgentRunError(code), failedStepId: null };
}

/** Every step result of a run in one list, as the failure and timeline readers walk them. */
export function runStepResults(
  run: AgentPlanRun,
): readonly AgentPlanStepResult[] {
  return allPlanRunResults(run);
}
