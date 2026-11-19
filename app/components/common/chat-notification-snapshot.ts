import { toastChatKey } from "@/app/components/ui/toast/toast-types";

import type {
  ChatNotificationDigest,
  ChatNotificationEntry,
  ChatNotificationMessage,
} from "@/definition/ChatNotificationDigest";

/** What a notification remembers of a chat between two readings. */
export interface ChatNotificationMark {
  /** The newest message of the chat at the last reading; `null` before the first one. */
  readonly latestId: string | null;
  /** Its time in milliseconds, so an older message that moves up after a deletion announces nothing. */
  readonly latestAt: number;
  readonly unreadCount: number;
}

/** What one chat announces now. */
export interface ChatNotificationArrival {
  readonly message: ChatNotificationMessage;
  /** How many messages arrived, at least one. */
  readonly count: number;
}

function instant(message: ChatNotificationMessage | null): number {
  if (!message) return Number.NEGATIVE_INFINITY;
  const time = Date.parse(message.createdAt);
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
}

/** Whether a message is one somebody else wrote, which a notification may announce. */
function isIncoming(
  message: ChatNotificationMessage | null,
): message is ChatNotificationMessage {
  return message !== null && message.authorId !== null && !message.isNotice;
}

/** Remembers the newest message and unread count of each chat of a reading. */
export function chatNotificationMarks(
  digest: ChatNotificationDigest,
): Map<string, ChatNotificationMark> {
  return new Map(
    digest.entries.map((entry) => [
      toastChatKey(entry.chat),
      {
        latestId: entry.latest?.id ?? null,
        latestAt: instant(entry.latest),
        unreadCount: entry.unreadCount,
      },
    ]),
  );
}

/**
 * Finds a genuinely new incoming message of a chat since the last reading;
 * reads, own messages, notices and an older message that becomes the newest
 * after a deletion announce nothing.
 * @param entry - The chat in the current reading.
 * @param previous - What the last reading remembered of every chat.
 * @returns The newest arrived message with the number of arrivals, or `null`.
 */
export function newChatArrival(
  entry: ChatNotificationEntry,
  previous: ReadonlyMap<string, ChatNotificationMark>,
): ChatNotificationArrival | null {
  const { latest } = entry;
  if (!isIncoming(latest)) return null;
  const known = previous.get(toastChatKey(entry.chat));
  if (!known)
    return entry.unreadCount > 0
      ? { message: latest, count: entry.unreadCount }
      : null;
  if (latest.id === known.latestId || instant(latest) <= known.latestAt)
    return null;
  return {
    message: latest,
    count: Math.max(1, entry.unreadCount - known.unreadCount),
  };
}
