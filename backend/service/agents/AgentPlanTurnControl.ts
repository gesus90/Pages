import { AgentPlanCancelledError } from "@/backend/error/AgentPlanCancelledError";

import { planPauseGate } from "./AgentPlanPauseGate";
import { closedSessionChanges } from "./AgentPlanSessionRecords";
import { waitForTurn } from "./AgentPlanTurn";

import type {
  PlanSession,
  PlanSessionTurn,
} from "@/backend/agents/AgentPlanExecution";
import type { AgentPlanSessionRecord } from "@/definition/AgentPlanSession";
import type { AgentPlanStepProgressTodo } from "@/definition/AgentPlanStepProgress";
import type { AgentPlanStepProgressService } from "./AgentPlanStepProgressService";
import type { PlanSessionCloseout } from "./AgentPlanSessionCloseout";
import type { NodeRun } from "./AgentPlanStepContext";

/** Reads the durable todo states a replacement turn continues from. */
export async function planStepProgress(
  node: NodeRun,
  progress: Pick<AgentPlanStepProgressService, "find"> | undefined,
): Promise<readonly AgentPlanStepProgressTodo[]> {
  const previous = await progress?.find(node.run.id, node.step.step.id);
  return previous?.todos ?? [];
}

/**
 * Holds completion during Pause and cancels an unresolved turn on Stop or timeout.
 *
 * @returns The turn, or `null` after abort cleanup has been recorded. The caller
 * judges cancellation, timeout and failed cleanup from the unchanged signal
 * and the recorded evidence rather than inferring success from an abort.
 */
export async function controlledPlanSessionTurn(
  node: NodeRun,
  session: Pick<PlanSession, "turn">,
  cleanup: {
    readonly close: () => Promise<PlanSessionCloseout>;
    readonly save: (changes: Partial<AgentPlanSessionRecord>) => Promise<void>;
  },
): Promise<PlanSessionTurn | null> {
  try {
    // Observe rejection even if already aborted; the original turn still throws below.
    const settled = session.turn.then(
      () => undefined,
      () => undefined,
    );
    await waitForTurn(settled, node.control.signal);
    await planPauseGate(node.run.id).wait(node.control.signal);
    return await session.turn;
  } catch (error: unknown) {
    if (!(error instanceof AgentPlanCancelledError)) throw error;
    const { closed } = await cleanup.close();
    await cleanup.save({ ...closedSessionChanges(closed), resultCode: -1 });
    return null;
  }
}
