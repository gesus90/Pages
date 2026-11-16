import { logEvent } from "@/backend/logging/Logger";

import type { ConversationHandoffRequest } from "@/backend/database/repositories/conversation/ConversationHandoffRepository";
import type { ConversationRound } from "./ConversationReplyTypes";

const COMPONENT = "ConversationAgentReplies";

/** A stored @ hand-over waits for a message of a person; nothing shows in the chat. */
export function logPausedHandoff(
  handoff: ConversationHandoffRequest,
  reason: "agent_streak" | "restart",
): void {
  logEvent({
    level: "info",
    event: "conversation.agent_reply.paused",
    component: COMPONENT,
    message: "A hand-over with @ was stored and waits until a person writes.",
    metadata: {
      conversationId: handoff.conversationId,
      agentId: handoff.agentId,
      triggerMessageId: handoff.triggerMessageId,
      reason,
    },
  });
}

/** The limit of contributions without @ of a round held back a further answer. */
export function logRoundLimit(round: ConversationRound, agentId: string): void {
  logEvent({
    level: "info",
    event: "conversation.agent_reply.limit",
    component: COMPONENT,
    message:
      "The limit of contributions without @ of a round held back a further answer.",
    metadata: { conversationId: round.conversation.id, agentId },
  });
}
