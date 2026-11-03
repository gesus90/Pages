import { logCaughtError } from "@/backend/logging/Logger";

import { canSchedule } from "../AgentPlanRunState";
import {
  planStackResult,
  triggeredPlanStackView,
} from "../stack/AgentPlanStackTrigger";
import { patchIterationNode } from "./AgentPlanLoopRecord";

import type { SerialQueue } from "@/backend/concurrency/SerialQueue";
import type { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";
import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { AgentPlanLoopRun } from "@/definition/AgentPlanLoopRun";
import type { AgentPlanStackHandover } from "@/definition/AgentPlanStack";
import type { ActivePlanRun } from "../AgentPlanRunState";
import type { LoopHost } from "./AgentPlanLoopHost";

/** What the engine lends a loop: its serial write queue, the run store and the access check. */
export interface LoopHostDependencies {
  readonly writes: SerialQueue;
  readonly runs: Pick<AgentPlanRunRepository, "update">;
  readonly authorize: () => Promise<void>;
}

/**
 * Gives a loop its view of the run it is part of.
 *
 * @param active - The live state of the run, owned by the engine.
 * @param signal - The abort signal of the loop's node.
 * @param dependencies - The engine's queue and store.
 *
 * @remarks
 * Every change of the loop's state goes through the engine's serial write
 * queue and is stored with the run, the way the engine stores a node's
 * result. A write that fails stops all work of the run, as it does for a
 * node, and the loop sees the error.
 */
export function createLoopHost(
  active: ActivePlanRun,
  signal: AbortSignal,
  dependencies: LoopHostDependencies,
): LoopHost {
  async function store(previous: AgentPlanRun): Promise<void> {
    try {
      await dependencies.runs.update(active.view);
    } catch (error: unknown) {
      logCaughtError("AgentPlanLoopEngineHost", error);
      active.view = previous;
      active.hasPersistenceFailure = true;
      for (const controller of active.controllers.values()) controller.abort();
      throw error;
    }
  }
  return {
    signal,
    run: () => active.view,
    snapshot: () => active.snapshot,
    canDispatch: () => canSchedule(active),
    isPausing: () =>
      active.view.status === "pausing" || active.view.status === "paused",
    authorize: dependencies.authorize,
    current: (loopId) =>
      active.view.loops?.find((entry) => entry.id === loopId),
    update: (loopId, change) =>
      dependencies.writes.run(async (): Promise<AgentPlanLoopRun> => {
        const previous = active.view;
        const record = previous.loops?.find((entry) => entry.id === loopId);
        if (!record) throw new Error("The loop has no recorded state.");
        const next = change(record);
        active.view = withLoopRun(previous, next);
        await store(previous);
        return next;
      }),
    triggerStack: (loopId, target) =>
      dependencies.writes.run(async (): Promise<AgentPlanStackHandover> => {
        const previous = active.view;
        const record = previous.loops?.find((entry) => entry.id === loopId);
        const stack = active.snapshot.plan.nodes.find(
          (node) => node.id === target.stackId,
        );
        if (!record || stack?.type !== "stack")
          throw new Error("The loop or its stack has no recorded state.");
        const triggered = triggeredPlanStackView(previous, stack, {
          loopId,
          iteration: target.number,
        });
        active.view = withLoopRun(
          triggered.view,
          patchIterationNode(
            record,
            { number: target.number, nodeId: stack.id },
            planStackResult(triggered.handover),
          ),
        );
        await store(previous);
        return triggered.handover;
      }),
  };
}

function withLoopRun(run: AgentPlanRun, next: AgentPlanLoopRun): AgentPlanRun {
  return {
    ...run,
    loops: (run.loops ?? []).map((entry) =>
      entry.id === next.id ? next : entry,
    ),
  };
}
