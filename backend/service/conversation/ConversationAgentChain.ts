import { CONVERSATION_DECISION_LIMITS } from "@/definition/ConversationDecision";

import type { ConversationMessageRepository } from "@/backend/database/repositories/conversation/ConversationMessageRepository";
import type { ConversationAccounts } from "./ConversationDirectory";

/**
 * Whether a group stands at the chain pause (PAGE-349): its newest
 * `CONVERSATION_DECISION_LIMITS.agentStreak` messages are all of agents,
 * without a message of a person between them.
 *
 * @remarks
 * This is only the guard against endless talk between agents. A hand-over
 * met here is stored, never dropped, and starts once a person writes.
 */
export async function isAgentChainPaused(
  messages: Pick<ConversationMessageRepository, "history">,
  accounts: ConversationAccounts,
  conversationId: string,
): Promise<boolean> {
  const streak = CONVERSATION_DECISION_LIMITS.agentStreak;
  const newestFirst = await messages.history(conversationId, null, streak);
  return (
    newestFirst.length >= streak &&
    newestFirst.every(
      (message) => accounts.find(message.senderId)?.user.isAgent === true,
    )
  );
}
