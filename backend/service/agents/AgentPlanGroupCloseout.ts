import { logCaughtError } from "@/backend/logging/Logger";

import {
  canSchedule,
  readySteps,
  type ActivePlanRun,
} from "./AgentPlanRunState";
import { settlePlanRun } from "./AgentPlanRunSettle";
import { hasPendingEvents } from "./branching/AgentPlanBranchSettle";

import type { SerialQueue } from "@/backend/concurrency/SerialQueue";
import type { EngineDependencies } from "./AgentPlanEngineDependencies";

/** Whether the run keeps sessions open between nodes: groups, loops, or agents that receive events. */
function keepsSessions(active: ActivePlanRun): boolean {
  const { plan, groups } = active.snapshot;
  return (
    Boolean(groups?.length) ||
    plan.nodes.some((node) => node.type === "loop") ||
    plan.edges.some((edge) => edge.toPort === "event-in")
  );
}

/** A run with nothing running, nothing ready and nothing waiting for a returning result. */
function isIdle(active: ActivePlanRun): boolean {
  return (
    active.groupCloseout === "open" &&
    active.controllers.size === 0 &&
    (readySteps(active).length === 0 || active.isInterrupted === true) &&
    (!hasPendingEvents(active) || !canSchedule(active)) &&
    (active.view.status !== "paused" ||
      active.view.stopRequested ||
      active.isInterrupted === true)
  );
}

/**
 * Ends the retained sessions of every run that has become idle, once per run.
 *
 * @param runs - The active runs.
 * @param dependencies - The queue that serializes the scheduler, the run store and the step runner that holds the sessions.
 *
 * @remarks
 * A result that landed since the last settle is settled first, in the same
 * turn of the queue that judges the run idle: otherwise a fix agent that ended
 * in between would look like the end of the run and its checker's session
 * would be closed before the result could return to it.
 *
 * A failing closeout is logged and never stops the run from closing; its
 * records tell whether the cleanup was confirmed.
 */
export async function closeIdlePlanGroups(
  runs: Iterable<ActivePlanRun>,
  dependencies: {
    readonly writes: SerialQueue;
    readonly runs: Pick<EngineDependencies["runs"], "update">;
    readonly steps: Pick<EngineDependencies["steps"], "closeGroups">;
  },
): Promise<void> {
  const closing = await dependencies.writes.run(async () => {
    const idle: ActivePlanRun[] = [];
    for (const active of runs) {
      if (active.groupCloseout !== "open") continue;
      if (settlePlanRun(active)) await dependencies.runs.update(active.view);
      if (isIdle(active)) idle.push(active);
    }
    for (const active of idle) active.groupCloseout = "closing";
    return idle;
  });
  for (const active of closing) {
    try {
      if (keepsSessions(active))
        await dependencies.steps.closeGroups(active.view.id);
    } catch (error: unknown) {
      logCaughtError("AgentPlanRunEngine", error);
    } finally {
      active.groupCloseout = "closed";
    }
  }
}
