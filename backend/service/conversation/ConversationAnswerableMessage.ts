import { CONVERSATION_AGENT_SEND_PREFIX } from "@/definition/Conversation";

import type { ConversationMessage } from "@/definition/Conversation";
import type { ConversationEvent } from "./ConversationEvents";

/**
 * Whether a message asks for an answer: one a person wrote, or one an agent
 * chose to send (PAGE-311). The answer of an agent asks nobody, so two agents
 * never answer each other on their own.
 */
export function isAskingMessage(message: ConversationMessage): boolean {
  return (
    message.sender.kind === "human" ||
    message.clientMessageId.startsWith(CONVERSATION_AGENT_SEND_PREFIX)
  );
}

/** The message of a person, or one an agent chose to send, whose text is known now; `null` for every other change. */
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
  if (message.text.trim() === "") return null;
  return isAskingMessage(message) ? message : null;
}
