/**
 * Contracts of the lean reading the chat notifications of the web interface
 * follow, instead of the histories of the chat page.
 */

import type {
  VirtualChatSelection,
  VirtualParticipantKind,
} from "./VirtualChat";

/** The longest preview text of a message a notification shows. */
export const CHAT_NOTIFICATION_PREVIEW_CHARACTERS = 240;

/** The newest message of a chat, as a notification shows it. */
export interface ChatNotificationMessage {
  readonly id: string;
  /** The writing participant, or `null` for the person's own message. */
  readonly authorId: string | null;
  /** Kind and name of the author; `null` for the person's own message. */
  readonly author: {
    readonly name: string;
    readonly kind: VirtualParticipantKind;
  } | null;
  /** ISO time the message was stored. */
  readonly createdAt: string;
  /** The start of the text, at most {@link CHAT_NOTIFICATION_PREVIEW_CHARACTERS} characters. */
  readonly preview: string;
  readonly isVoice: boolean;
  /** A hint why an agent did not answer, or a system line; it announces nothing. */
  readonly isNotice: boolean;
}

/** One chat of the person with what a notification about it needs. */
export interface ChatNotificationEntry {
  readonly chat: VirtualChatSelection;
  readonly name: string;
  readonly avatarImageUrl: string | null;
  readonly isMuted: boolean;
  /** The stored conversation shown in the chat; `null` for an agent's chat session. */
  readonly conversationId: string | null;
  readonly unreadCount: number;
  /** The newest message of the chat; `null` before the first one. */
  readonly latest: ChatNotificationMessage | null;
}

/** The chats of the person, read for notifications without their histories. */
export interface ChatNotificationDigest {
  readonly entries: readonly ChatNotificationEntry[];
}
