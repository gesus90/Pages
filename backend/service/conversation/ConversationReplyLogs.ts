import { logEvent } from "@/backend/logging/Logger";

import type { ConversationHandoffRequest } from "@/backend/database/repositories/conversation/ConversationHandoffRepository";
import type { ConversationMessage } from "@/definition/Conversation";
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

/** The @ of an interim message woke nobody because the chain of agent messages is used up. */
export function logPausedInterim(message: ConversationMessage): void {
  logEvent({
    level: "info",
    event: "conversation.agent_reply.paused",
    component: COMPONENT,
    message:
      "The @ of an interim message started nobody: the agents wrote the most they may in a row.",
    metadata: {
      conversationId: message.conversationId,
      messageId: message.id,
      reason: "agent_streak",
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

/**
 * A stored message whose answer could not be started stays stored and is
 * not started again; the log names the message and its conversation, never
 * its text.
 */
export function logStartFailure(
  message: ConversationMessage,
  error: unknown,
): void {
  logEvent({
    level: "error",
    event: "conversation.agent_reply.start_failed",
    component: COMPONENT,
    message:
      "The answer to a stored message could not be started; the message is not answered.",
    metadata: {
      conversationId: message.conversationId,
      messageId: message.id,
    },
    error,
  });
}

/** A message that asks for an answer found no account or membership of its sender. */
export function logUnanswerable(
  message: ConversationMessage,
  reason: "no_sender" | "no_membership",
): void {
  logEvent({
    level: "warn",
    event: "conversation.agent_reply.unanswerable",
    component: COMPONENT,
    message: "A message that asks for an answer was not answered.",
    metadata: {
      conversationId: message.conversationId,
      messageId: message.id,
      reason,
    },
  });
}
