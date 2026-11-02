import {
  canSchedule,
  settlePlanPause,
  type ActivePlanRun,
} from "./AgentPlanRunState";
import {
  queuePlanEvents,
  settlePlanBranching,
} from "./branching/AgentPlanBranchSettle";

/**
 * Brings a run up to date under the scheduler's queue: its pause, then its decisions and returning events.
 *
 * @param active - The run.
 * @returns Whether the view of the run changed and must be stored.
 *
 * @remarks
 * A run that is pausing queues the results on their way back first, so that
 * the pause boundary names the agent they will start again. Decisions and
 * returning events settle before anything judges the run idle, which would
 * otherwise end the sessions they are about to continue.
 */
export function settlePlanRun(active: ActivePlanRun): boolean {
  const previous = active.view;
  if (active.view.status === "pausing") queuePlanEvents(active);
  settlePlanPause(active);
  // Decisions and returning events settle before the idle check, which would otherwise close their sessions.
  if (canSchedule(active)) settlePlanBranching(active);
  return previous !== active.view;
}
