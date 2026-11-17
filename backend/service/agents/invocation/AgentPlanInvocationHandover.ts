import { AgentError } from "@/backend/error/AgentErrors";
import { AgentPlanCancelledError } from "@/backend/error/AgentPlanCancelledError";

import { hasUnconfirmedRunCloseout } from "../AgentPlanRunState";

import type { ActivePlanRun } from "../AgentPlanRunState";

/** How often the settling of the other work of the calling run is looked at; no database is read. */
const QUIET_CHECK_MS = 250;

/** Whether the node is an outgoing Jump of the frozen plan. */
function isOutgoingJump(active: ActivePlanRun, nodeId: string): boolean {
  return active.snapshot.plan.nodes.some(
    (node) =>
      node.id === nodeId && node.type === "jump" && node.direction === "out",
  );
}

function otherWork(active: ActivePlanRun, nodeId: string): readonly string[] {
  return [...active.controllers.keys()].filter((id) => id !== nodeId);
}

/**
 * Brings the calling run to rest before its workspace is handed to the called run.
 * @param active - The calling run.
 * @param nodeId - The waiting Jump node.
 * @param signal - Aborts the wait, as a stop of the run does.
 * @param deadline - The end of the Jump's wait as a time, or `null` for none.
 * @throws {AgentError} `plan_jump_handover_unavailable` when the run keeps a
 * session open, when another call of the run waits at the same time, or when
 * the other work does not settle before the deadline.
 * @remarks
 * Dispatch is closed first, so nothing new starts. The other running nodes
 * of the run then finish on their own; they are never cut off. The handover is
 * only safe once every writer of the run has ended and no retained session
 * keeps a process open, so an unconfirmed session or a second waiting call is
 * a concrete refusal instead of a wait that might never end.
 */
export async function quiesceForHandover(
  active: ActivePlanRun,
  nodeId: string,
  options: { readonly signal: AbortSignal; readonly deadline: number | null },
): Promise<void> {
  active.isHandingOver = true;
  for (;;) {
    if (options.signal.aborted) throw new AgentPlanCancelledError();
    const others = otherWork(active, nodeId);
    const pendingResults = active.branching?.pending.length ?? 0;
    if (others.length === 0 && pendingResults === 0) break;
    // Two calls that each wait for the other to settle would wait for ever.
    if (others.some((id) => isOutgoingJump(active, id)))
      throw new AgentError("plan_jump_handover_unavailable");
    if (options.deadline !== null && Date.now() >= options.deadline)
      throw new AgentError("plan_jump_handover_unavailable");
    await new Promise<void>((resolve) => {
      setTimeout(resolve, QUIET_CHECK_MS).unref();
    });
  }
  if (hasUnconfirmedRunCloseout(active.view))
    throw new AgentError("plan_jump_handover_unavailable");
}
