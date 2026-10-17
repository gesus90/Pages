import { AgentError } from "@/backend/error/AgentErrors";

import type {
  AgentPlanSessionInput,
  PlanSessionObserver,
} from "@/backend/agents/AgentPlanExecution";
import type { AgentPlanGroupSessions } from "./AgentPlanGroupSessions";
import type { AgentSessionNode } from "./sessions/AgentSessionAttempts";
import type { AgentSessionService } from "./sessions/AgentSessionService";

/** An instruction turn only the journal observes; the finished node's record stays as it is. */
const JOURNAL_ONLY: PlanSessionObserver = {
  started: () => undefined,
  identified: () => undefined,
};

/** A group member whose open session the executor may instruct. */
export interface GroupInstructionOffer {
  readonly sessions: Pick<AgentSessionService, "offer" | "listen" | "settle">;
  readonly groups: Pick<AgentPlanGroupSessions, "instruct">;
  readonly node: AgentSessionNode & {
    readonly control: { readonly signal: AbortSignal };
  };
  /** The run and group, as `runId/groupId`. */
  readonly key: string;
  /** The member's frozen input; only the prompt of an instruction turn differs. */
  readonly input: AgentPlanSessionInput;
}

/**
 * Offers the open group session of a member for the executor's instructions.
 *
 * @remarks
 * An instruction becomes a turn of its own in the group's queue: after the
 * member's turn and before any later member, with the instruction as its only
 * prompt, so the pinned plan prompt stays unchanged. The turn is recorded
 * into the member's attempt. Pages can end an ACP turn only by ending the
 * shared process, so a turn alone is never cancelled; the run's stop closes
 * the group with it.
 */
export function offerGroupInstructions(offer: GroupInstructionOffer): void {
  const { sessions, groups, node, key, input } = offer;
  const attemptId = node.record?.attemptId;
  if (!attemptId) return;
  sessions.offer(
    { attemptId, instanceId: input.instanceId },
    {
      instruct: async (text) => {
        if (node.control.signal.aborted)
          throw new AgentError("plan_session_unavailable");
        const turn = await groups.instruct({
          key,
          input: {
            ...input,
            prompt: text,
            journal: sessions.listen(node, input.instanceId),
          },
          signal: node.control.signal,
          observer: JOURNAL_ONLY,
        });
        await sessions.settle(node.record, turn);
      },
    },
  );
}
