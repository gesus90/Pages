import { toastChatKey } from "@/app/components/ui/toast/toast-types";

import type {
  VirtualChatDirectory,
  VirtualChatMessage,
  VirtualChatSelection,
} from "@/definition/VirtualChat";

/** One rights-checked chat and the incoming messages the current directory contains. */
export interface ChatNotificationSnapshot {
  readonly chat: VirtualChatSelection;
  readonly name: string;
  readonly avatarImageUrl: string | null;
  readonly isMuted: boolean;
  readonly unreadCount: number;
  readonly messages: readonly VirtualChatMessage[];
}

/** Keeps the directory's chat identity, including agent histories and direct conversations. */
export function chatNotificationSnapshots(
  directory: VirtualChatDirectory,
): ChatNotificationSnapshot[] {
  return [
    ...directory.participants.map((participant) => ({
      chat: { kind: "participant", id: participant.id } as const,
      name: participant.name,
      avatarImageUrl: participant.avatarImageUrl,
      isMuted: participant.isMuted === true,
      unreadCount: participant.unreadCount,
      messages: directory.histories[participant.id] ?? [],
    })),
    ...directory.groups
      .filter((group) => !group.isAgentConversation)
      .map((group) => ({
        chat: { kind: "group", id: group.id } as const,
        name: group.name,
        avatarImageUrl: null,
        isMuted: group.isMuted === true,
        unreadCount: group.unreadCount,
        messages: directory.histories[group.id] ?? [],
      })),
  ];
}

/** Finds genuinely new incoming messages; reads, edits, own messages and tool updates announce nothing. */
export function newChatMessages(
  snapshot: ChatNotificationSnapshot,
  previous: ReadonlyMap<string, ReadonlySet<string>>,
): readonly VirtualChatMessage[] {
  const known = previous.get(toastChatKey(snapshot.chat));
  const incoming = snapshot.messages.filter(
    (message) => message.authorId !== null && !message.notice,
  );
  if (!known)
    return snapshot.unreadCount > 0
      ? incoming.slice(-snapshot.unreadCount)
      : [];
  // A deletion can fill the oldest edge with an older message. Only the
  // suffix after the last known message represents new arrivals.
  const lastKnown = snapshot.messages.findLastIndex((message) =>
    known.has(message.id),
  );
  return snapshot.messages
    .slice(lastKnown + 1)
    .filter((message) => message.authorId !== null && !message.notice);
}
