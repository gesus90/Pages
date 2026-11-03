import { isActivePlanRun } from "@/definition/AgentPlanRunState";

import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";
import type {
  AgentPlanLoopIteration,
  AgentPlanLoopRun,
} from "@/definition/AgentPlanLoopRun";

/** A step instance that changed from waiting to running. */
export interface AgentPlanStartedStep {
  /** The node of the step; for a loop member the member's own node. */
  readonly stepId: string;
  /** The loop a member belongs to; `null` for a step of the flow itself. */
  readonly loopId: string | null;
  /** The iteration of a loop member, counted from 1; `null` outside a loop. */
  readonly iteration: number | null;
  /** The attempt this start belongs to, counted from 1. */
  readonly attempt: number;
}

/** The ending states a run reaches once. */
export type AgentPlanRunEnding = "succeeded" | "failed" | "cancelled";

/**
 * A change between two stored views of a run that is worth a notification.
 *
 * @remarks
 * Both kinds are facts of the stored run, not of a screen: a step went from
 * waiting to running, or the run left its active states for good.
 */
export type AgentPlanRunTransition =
  | {
      readonly kind: "steps_started";
      readonly steps: readonly AgentPlanStartedStep[];
    }
  | {
      readonly kind: "run_ended";
      readonly ending: AgentPlanRunEnding;
      /** The failure code of the first failed step, for a failed run. */
      readonly reason: string | null;
    };

const FAILURE_CODE = /^[a-z][a-z0-9_.:-]{0,99}$/u;

function attemptOf(step: AgentPlanStepResult): number {
  return (step.session?.retry?.attempts.length ?? 0) + 1;
}

function startedTopLevelSteps(
  previous: AgentPlanRun,
  next: AgentPlanRun,
): readonly AgentPlanStartedStep[] {
  const before = new Map(previous.steps.map((step) => [step.id, step.status]));

  return next.steps
    .filter(
      (step) => step.status === "running" && before.get(step.id) === "waiting",
    )
    .map((step) => ({
      stepId: step.id,
      loopId: null,
      iteration: null,
      attempt: attemptOf(step),
    }));
}

function startedMembers(
  loop: AgentPlanLoopRun,
  earlier: AgentPlanLoopRun | undefined,
  iteration: AgentPlanLoopIteration,
): readonly AgentPlanStartedStep[] {
  const before = new Map(
    earlier?.iterations
      .find((entry) => entry.number === iteration.number)
      ?.nodes.map((node) => [node.id, node.status]) ?? [],
  );

  return iteration.nodes
    .filter(
      (node) =>
        node.status === "running" &&
        (!before.has(node.id) || before.get(node.id) === "waiting"),
    )
    .map((node) => ({
      stepId: node.id,
      loopId: loop.id,
      iteration: iteration.number,
      attempt: attemptOf(node),
    }));
}

function startedLoopMembers(
  previous: AgentPlanRun,
  next: AgentPlanRun,
): readonly AgentPlanStartedStep[] {
  return (next.loops ?? []).flatMap((loop) => {
    const earlier = previous.loops?.find((entry) => entry.id === loop.id);

    return loop.iterations.flatMap((iteration) =>
      startedMembers(loop, earlier, iteration),
    );
  });
}

/**
 * Returns the machine failure code of a run.
 *
 * @param run - A stored view of the run.
 * @returns The error of the first failed step, otherwise the control error of
 * the run, but only when it is a machine code; `null` for free text such as
 * paths or provider output, and without any failure.
 */
export function failureReason(run: AgentPlanRun): string | null {
  const failed = run.steps.find((step) => step.status === "failed");
  const code = failed?.error ?? run.controlError ?? null;

  return code !== null && FAILURE_CODE.test(code) ? code : null;
}

/**
 * Finds what changed between two stored views of one run.
 *
 * @param previous - The view before the write.
 * @param next - The view after the write.
 * @returns The started steps and the ending of the run, each at most once;
 * empty for every other write, such as a progress record or a retry of a
 * step that never left `running`.
 *
 * @remarks
 * It is cheap and pure so it can run on every write of a run. A retry keeps
 * its step `running`, a pause or a stop request changes no step to `running`,
 * and an ending is reported only on the write that leaves the active states.
 */
export function detectPlanRunTransitions(
  previous: AgentPlanRun,
  next: AgentPlanRun,
): readonly AgentPlanRunTransition[] {
  const transitions: AgentPlanRunTransition[] = [];
  const steps = [
    ...startedTopLevelSteps(previous, next),
    ...startedLoopMembers(previous, next),
  ];

  if (steps.length > 0) {
    transitions.push({ kind: "steps_started", steps });
  }

  if (isActivePlanRun(previous.status) && !isActivePlanRun(next.status)) {
    transitions.push({
      kind: "run_ended",
      ending: next.status,
      reason: next.status === "failed" ? failureReason(next) : null,
    });
  }

  return transitions;
}
