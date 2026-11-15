import { ConversationError } from "@/backend/error/ConversationError";
import {
  CONVERSATION_NAME_MAXIMUM_LENGTH,
  CONVERSATION_TEXT_MAXIMUM_LENGTH,
} from "@/definition/Conversation";
import { conversationAttachmentIdsSchema } from "@/definition/ConversationContent";

import { findConversationMentions } from "./ConversationMentions";

import type { StoredConversationMessage } from "@/backend/database/repositories/conversation/ConversationMessageRepository";
import type { PagesEvent } from "@/backend/service/events/PagesEventPublisher";
import type { ConversationMessage } from "@/definition/Conversation";
import type { ConversationServiceDependencies } from "./ConversationService";

/** Builds the live change event of one conversation. */
export function conversationChangedEvent(conversationId: string): PagesEvent {
  return { type: "conversation.changed", id: conversationId };
}

/** Reads the attachments a message names; none when it names none. */
export function readMessageAttachmentIds(input: unknown): readonly string[] {
  if (input === undefined || input === null) return [];
  const ids = conversationAttachmentIdsSchema.safeParse(input);
  if (!ids.success) throw new ConversationError("invalid");
  return ids.data;
}

/** Reads the text of a message; it may be empty only next to attachments. */
export function readMessageText(
  input: unknown,
  hasAttachments: boolean,
): string {
  if (typeof input !== "string") throw new ConversationError("invalid");
  const text = input.trim();
  if (text === "" && !hasAttachments) throw new ConversationError("invalid");
  if (Array.from(text).length > CONVERSATION_TEXT_MAXIMUM_LENGTH)
    throw new ConversationError("too_long");
  return text;
}

/** Validates and trims the name of a conversation group. */
export function readConversationGroupName(
  input: string | null | undefined,
): string {
  const name = (input ?? "").trim();
  if (name === "" || Array.from(name).length > CONVERSATION_NAME_MAXIMUM_LENGTH)
    throw new ConversationError("invalid");
  return name;
}

/** Recognizes the text of a stored voice message and publishes the updated message. */
export async function transcribeConversationVoice(
  dependencies: Pick<
    ConversationServiceDependencies,
    "transcriber" | "files" | "directory" | "messages" | "reader"
  >,
  stored: StoredConversationMessage,
  memberIds: readonly string[],
  announce: (message: ConversationMessage) => void,
): Promise<void> {
  const { voice } = stored;
  if (!voice) return;
  const outcome = await dependencies.transcriber.transcribe({
    open: () => dependencies.files.open(voice.storageName),
    mimeType: voice.mimeType,
    sizeBytes: voice.sizeBytes,
  });
  const accounts = await dependencies.directory.read();
  const text = outcome.ok
    ? Array.from(outcome.text.trim())
        .slice(0, CONVERSATION_TEXT_MAXIMUM_LENGTH)
        .join("")
    : "";
  // A group asks its agents by mention; the recognized text may name one.
  const mentions = findConversationMentions(text, memberIds, {
    accounts,
    senderId: stored.senderId,
  });
  const updated = await dependencies.messages.completeTranscription(
    stored.id,
    { state: outcome.ok ? "done" : "failed", text, mentions },
    conversationChangedEvent(stored.conversationId),
  );
  if (!updated) return;
  const [message] = await dependencies.reader.messages([updated], accounts);
  if (message) announce(message);
}
