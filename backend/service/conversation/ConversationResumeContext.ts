import type { ConversationMessageRepository } from "@/backend/database/repositories/conversation/ConversationMessageRepository";
import type { ConversationRoundRepository } from "@/backend/database/repositories/conversation/ConversationRoundRepository";

/** The most messages a resumed hand-over reads since the agent's last message. */
const RESUME_CONTEXT_MESSAGES = 50;

/** What reading the context of a continuation needs from the stores. */
export interface ConversationReplyContextDependencies {
  readonly messages: Pick<ConversationMessageRepository, "history">;
  readonly rounds: Pick<ConversationRoundRepository, "followUps">;
}

/** The request of an agent's answer that decides which messages it also reads. */
export interface ConversationReplyContextRequest {
  readonly agentId: string;
  readonly triggerMessageId: string;
  readonly isFollowUp?: boolean;
  /** The stored @ hand-over the answer takes. */
  readonly handoff?: "pending" | "paused";
}

/**
 * The messages a continuation reads besides the history: a batch gets the
 * round replies since its question, a resumed hand-over every message since
 * the agent's last one. Both are read after the claim, so nothing bundled
 * meanwhile is missing.
 * @param dependencies - The stored messages and rounds.
 * @param round - The conversation and the message that opened the round.
 * @param request - The answer that is about to run.
 * @returns The message IDs to add; `undefined` for an answer that reads only the history.
 */
export async function replyContextMessageIds(
  dependencies: ConversationReplyContextDependencies,
  round: {
    readonly conversationId: string;
    readonly originMessageId: string;
  },
  request: ConversationReplyContextRequest,
): Promise<readonly string[] | undefined> {
  if (request.isFollowUp)
    return dependencies.rounds.followUps.context(
      round.originMessageId,
      request.triggerMessageId,
    );
  if (request.handoff !== "paused") return undefined;
  const newestFirst = await dependencies.messages.history(
    round.conversationId,
    null,
    RESUME_CONTEXT_MESSAGES,
  );
  const since = [];
  for (const message of newestFirst) {
    if (message.senderId === request.agentId) break;
    if (message.notice === null) since.push(message.id);
  }
  return since.reverse();
}
