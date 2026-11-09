import { AgentError } from "@/backend/error/AgentErrors";

import type {
  PlanInstructionControl,
  PlanInstructionWork,
} from "./AgentPlanInstructionControl";
import type {
  PlanSession,
  PlanSessionTurn,
} from "@/backend/agents/AgentPlanExecution";
import type {
  AgentPlanSessionInput,
  PlanSessionObserver,
} from "@/backend/agents/AgentPlanExecution";
import type { AgentPlanGroupSessions } from "./AgentPlanGroupSessions";
import type { AgentSessionNode } from "./sessions/AgentSessionAttempts";
import type { AgentSessionService } from "./sessions/AgentSessionService";

/** An instruction turn only the journal observes; the finished node's record stays as it is. */
export const JOURNAL_ONLY: PlanSessionObserver = {
  started: () => undefined,
  identified: () => undefined,
};

/** A group member whose open session the executor may instruct. */
export interface GroupInstructionOffer {
  readonly sessions: Pick<AgentSessionService, "offer" | "listen" | "settle">;
  readonly groups: Pick<AgentPlanGroupSessions, "instruct">;
  readonly node: AgentSessionNode & {
    readonly control: {
      readonly signal: AbortSignal;
      readonly runInstruction?: (
        work: PlanInstructionWork,
      ) => Promise<PlanSessionTurn>;
    };
  };
  /** The run and group, as `runId/groupId`. */
  readonly key: string;
  /** The member's frozen input; only the prompt of an instruction turn differs. */
  readonly input:
    AgentPlanSessionInput | (() => Promise<AgentPlanSessionInput>);
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
  const record = node.record;
  const attemptId = record?.attemptId;
  if (!record || !attemptId) return;
  sessions.offer(
    { attemptId, instanceId: record.instanceId },
    {
      instruct: async (text) => {
        const prepared = typeof input === "function" ? await input() : input;
        if (node.control.signal.aborted)
          throw new AgentError("plan_session_unavailable");
        const instruct = (
          control: PlanInstructionControl,
        ): Promise<PlanSessionTurn> =>
          groups.instruct({
            key,
            input: {
              ...prepared,
              prompt: text,
              journal: prepared.journal
                ? sessions.listen(node, prepared.instanceId)
                : undefined,
              resourceContext: prepared.resourceContext
                ? { ...prepared.resourceContext, isLocalInstruction: true }
                : undefined,
              beforeStart: async () => {
                await prepared.beforeStart?.();
                control.claimStart();
              },
            },
            signal: control.signal,
            observer: JOURNAL_ONLY,
          });
        const turn = node.control.runInstruction
          ? await node.control.runInstruction(instruct)
          : await instruct({
              signal: node.control.signal,
              claimStart: () => undefined,
            });
        await sessions.settle(node.record, turn);
      },
    },
  );
}

/**
 * Lets the executor type into and interrupt the running turn of a single
 * agent node, the same way for every provider (PAGE-284).
 *
 * @param sessions - The PageAgentCLI sessions that take the offer.
 * @param node - The node whose record names the attempt and the process.
 * @param session - The running session of the node.
 */
export function offerTurnInput(
  sessions: Pick<AgentSessionService, "offer">,
  node: Pick<AgentSessionNode, "record">,
  session: Pick<PlanSession, "steer" | "interrupt">,
): void {
  const record = node.record;
  if (!record?.attemptId || !session.steer) return;
  const steer = session.steer.bind(session);
  const interrupt = session.interrupt?.bind(session);
  sessions.offer(
    { attemptId: record.attemptId, instanceId: record.instanceId },
    {
      // A single node takes no turn after its own; its input joins the running one.
      instruct: () =>
        Promise.reject(new AgentError("plan_session_unavailable")),
      steer: async (text) =>
        ["injected", "startedNewTurn"].includes(
          await steer([{ type: "text", text }]),
        ),
      ...(interrupt ? { cancelTurn: interrupt } : {}),
    },
  );
}
