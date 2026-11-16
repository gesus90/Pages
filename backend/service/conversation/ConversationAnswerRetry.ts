import { ConversationError } from "@/backend/error/ConversationError";

import { changedEvent } from "./ConversationReplyNotices";

import type { ConversationMessageRepository } from "@/backend/database/repositories/conversation/ConversationMessageRepository";
import type { ConversationRepository } from "@/backend/database/repositories/conversation/ConversationRepository";
import type { ConversationRoundRepository } from "@/backend/database/repositories/conversation/ConversationRoundRepository";
import type { User } from "@/definition/User";
import type { ConversationRoundFollowUps } from "./ConversationRoundFollowUps";
import type { ConversationReplyJob } from "./ConversationReplyTypes";

/** What opening a failed answer again reads and changes. */
export interface ConversationAnswerRetryDependencies {
  readonly conversations: Pick<ConversationRepository, "findForMember">;
  readonly messages: Pick<
    ConversationMessageRepository,
    "findById" | "removeFailureNotice"
  >;
  readonly rounds: Pick<
    ConversationRoundRepository,
    "reopenFailed" | "setTargetState"
  >;
  readonly followUps: Pick<ConversationRoundFollowUps, "restore">;
}

/**
 * Opens the failed answer of an agent again when a member presses "Erneut
 * versuchen" under its hint: the answer is queued once more, the hint goes,
 * and the returned job runs it as the original round asked for it.
 * @param dependencies - The stored conversations, messages and rounds.
 * @param request - The member who asks, the hint and the current time.
 * @returns The job to run, or `null` when the answer already started again
 * or its round can no longer be restored.
 * @throws {ConversationError} `not_found` for a message that is no hint of a
 * failed answer in a conversation of the member.
 */
export async function reopenFailedAnswer(
  dependencies: ConversationAnswerRetryDependencies,
  request: {
    readonly person: User;
    readonly messageId: string;
    readonly now: string;
  },
): Promise<ConversationReplyJob | null> {
  const { conversations, messages, rounds, followUps } = dependencies;
  const notice = await messages.findById(request.messageId);
  if (notice?.notice !== "agent_failed")
    throw new ConversationError("not_found");
  const conversation = await conversations.findForMember(
    notice.conversationId,
    request.person.id,
  );
  if (!conversation) throw new ConversationError("not_found");
  // The update is the claim: a second press finds no failed answer any more.
  const reopened = await rounds.reopenFailed({
    replyMessageId: notice.id,
    agentId: notice.senderId,
    now: request.now,
  });
  if (!reopened) return null;
  const round = await followUps.restore({
    originMessageId: reopened.originMessageId,
    conversationId: notice.conversationId,
    personId: reopened.personId,
  });
  if (!round) {
    await rounds.setTargetState(reopened, {
      state: "failed",
      replyMessageId: notice.id,
      notice: "agent_failed",
      updatedAt: request.now,
    });
    return null;
  }
  await messages.removeFailureNotice(
    { id: notice.id, senderId: notice.senderId },
    changedEvent(notice.conversationId),
  );
  return {
    round,
    agentId: reopened.agentId,
    trigger: reopened.trigger,
    triggerMessageId: reopened.triggerMessageId,
    reason: reopened.reason,
  };
}
