import { triggerPlanStack } from "@/definition/AgentPlanStack";

import type { SerialQueue } from "@/backend/concurrency/SerialQueue";
import type { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";
import type { ActivePlanRun } from "../AgentPlanRunState";

import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";
import type {
  AgentPlanStack,
  AgentPlanStackHandover,
  AgentPlanStackRun,
} from "@/definition/AgentPlanStack";

/** The loop iteration that triggers a stack, or `null` values in the outer graph. */
export interface PlanStackOrigin {
  readonly loopId: string | null;
  readonly iteration: number | null;
}

/** The recorded state of a stack in a run, absent before its first trigger. */
export function planStackRunOf(
  run: Pick<AgentPlanRun, "stacks">,
  stackId: string,
): AgentPlanStackRun | undefined {
  return run.stacks?.find((entry) => entry.id === stackId);
}

/**
 * Applies one trigger of a stack to the view of a run.
 *
 * @param run - The current view; it is not changed.
 * @param stack - The frozen stack.
 * @param origin - The loop iteration that triggered it, if any.
 * @returns The new view and what the trigger handed over.
 *
 * @remarks
 * The next entry follows from the deliveries recorded in the view, so the
 * caller must apply and store the result in the same turn of the engine's
 * serial queue: two triggers then never hand over the same entry, and none is
 * skipped.
 */
export function triggeredPlanStackView(
  run: AgentPlanRun,
  stack: AgentPlanStack,
  origin: PlanStackOrigin,
): {
  readonly view: AgentPlanRun;
  readonly handover: AgentPlanStackHandover;
} {
  const { record, handover } = triggerPlanStack(
    planStackRunOf(run, stack.id),
    stack,
    { ...origin, at: new Date().toISOString() },
  );
  const others = (run.stacks ?? []).filter((entry) => entry.id !== stack.id);
  return { view: { ...run, stacks: [...others, record] }, handover };
}

/**
 * The result of a stack node for what its trigger handed over.
 *
 * @remarks
 * The node succeeds either way. A used-up stack hands over nothing: its
 * `entryId` is `null`, which kills the edges out of its flow output, so the
 * nodes behind it are skipped instead of working without an entry.
 */
export function planStackResult(
  handover: AgentPlanStackHandover,
): Partial<AgentPlanStepResult> {
  return {
    status: "succeeded",
    output: null,
    error: null,
    stack: handover,
  };
}

/**
 * Triggers a stack of the outer graph: it hands over its next entry, or nothing once used up.
 *
 * @param active - The live run, owned by the engine.
 * @param stack - The frozen stack node.
 * @param dependencies - The engine's serial queue, the run store and the access check.
 * @returns The result of the stack node.
 *
 * @remarks
 * The handover is recorded and stored in one turn of the serial queue, so two
 * triggers never hand over the same entry and none is skipped. A stopped run
 * hands over nothing; a paused one waits.
 */
export async function triggerOuterPlanStack(
  active: ActivePlanRun,
  stack: AgentPlanStack,
  dependencies: {
    readonly writes: SerialQueue;
    readonly runs: Pick<AgentPlanRunRepository, "update">;
    readonly authorize: () => Promise<void>;
  },
): Promise<Partial<AgentPlanStepResult>> {
  if (active.view.stopRequested)
    return { status: "cancelled", cancellation: "not_started" };
  if (active.view.status !== "running") return { status: "paused" };
  await dependencies.authorize();
  const handover = await dependencies.writes.run(async () => {
    const previous = active.view;
    const triggered = triggeredPlanStackView(previous, stack, {
      loopId: null,
      iteration: null,
    });
    active.view = triggered.view;
    try {
      await dependencies.runs.update(active.view);
    } catch (error: unknown) {
      active.view = previous;
      active.hasPersistenceFailure = true;
      for (const running of active.controllers.values()) running.abort();
      throw error;
    }
    return triggered.handover;
  });
  return planStackResult(handover);
}
