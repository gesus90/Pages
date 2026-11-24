import { CONVERSATION_AGENT_INTERIM_PREFIX } from "@/definition/AgentChatQuestion";
import { CONVERSATION_AGENT_SEND_PREFIX } from "@/definition/Conversation";

import type { ConversationMessage } from "@/definition/Conversation";
import type { ConversationEvent } from "./ConversationEvents";

/**
 * Whether an interim message of an agent names members with @.
 * @remarks
 * Such a message hands the agents it names the matter it speaks of, as a
 * message the agent chose to send does. An interim message without an @ stays
 * a quiet note of progress that asks nobody.
 */
export function isInterimMention(message: ConversationMessage): boolean {
  return (
    message.clientMessageId.startsWith(CONVERSATION_AGENT_INTERIM_PREFIX) &&
    message.mentions.length > 0
  );
}

/**
 * Whether a message asks for an answer: one a person wrote, one an agent
 * chose to send, or an interim message of an agent that names members with @.
 * The answer of an agent asks nobody, so two agents never answer each other
 * on their own.
 */
export function isAskingMessage(message: ConversationMessage): boolean {
  return (
    message.sender.kind === "human" ||
    message.clientMessageId.startsWith(CONVERSATION_AGENT_SEND_PREFIX) ||
    isInterimMention(message)
  );
}

/** The message that asks for an answer and whose text is known now; `null` for every other change. */
export function answerableMessage(
  event: ConversationEvent,
): ConversationMessage | null {
  if (event.kind !== "message" && event.kind !== "message_updated") return null;
  const { message } = event;
  // A voice message is answered once its text is recognized.
  const isWaiting =
    message.voice !== undefined && message.voice.transcriptionState !== "done";
  if (event.kind === "message_updated" && message.voice === undefined)
    return null;
  if (isWaiting || message.notice !== undefined) return null;
  if (message.text.trim() === "" && message.attachments.length === 0)
    return null;
  return isAskingMessage(message) ? message : null;
}
