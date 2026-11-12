import { useEffect } from "react";
import { useFetcher } from "react-router";

import type { VirtualChatMessage } from "@/definition/VirtualChat";
import type { OpenedConversation } from "./use-chat-page";

/** The stored conversation and unread count of an opened entry; agents have none. */
function readTarget(opened: OpenedConversation | null): {
  readonly conversationId: string;
  readonly unreadCount: number;
  /** The message to read up to when the shown history is not the stored conversation. */
  readonly upToMessageId?: string;
} | null {
  if (!opened) return null;
  if (opened.kind === "group")
    return {
      conversationId: opened.group.id,
      unreadCount: opened.group.unreadCount,
    };
  const { conversationId, unreadCount, agentChat } = opened.participant;
  if (agentChat && agentChat.newestMessageId !== "")
    return {
      conversationId: agentChat.conversationId,
      unreadCount,
      upToMessageId: agentChat.newestMessageId,
    };
  return conversationId ? { conversationId, unreadCount } : null;
}

/**
 * Marks the opened conversation with a person or of a group read up to its
 * newest stored message, whenever it shows unread messages (PAGE-278).
 *
 * @param opened - The opened group or participant.
 * @param messages - Its stored history, oldest first.
 */
export function useConversationRead(
  opened: OpenedConversation | null,
  messages: readonly VirtualChatMessage[],
): void {
  const reader = useFetcher();
  const { submit } = reader;
  const target = readTarget(opened);
  const conversationId = target?.conversationId ?? null;
  const unreadCount = target?.unreadCount ?? 0;
  const lastMessageId = target?.upToMessageId ?? messages.at(-1)?.id ?? null;
  useEffect(() => {
    if (conversationId === null || lastMessageId === null || unreadCount === 0)
      return;
    const formData = new FormData();
    formData.set("intent", "read");
    formData.set("conversationId", conversationId);
    formData.set("upToMessageId", lastMessageId);
    void submit(formData, { method: "post" });
  }, [conversationId, lastMessageId, unreadCount, submit]);
}
