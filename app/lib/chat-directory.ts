import type { VirtualChatDirectory } from "@/definition/VirtualChat";

/** The existing rights-checked chat page endpoint. */
export const CHAT_PAGE_ENDPOINT = "/chat-page-api/page";

/** The lean endpoint the chat notifications follow, without histories. */
export const CHAT_NOTIFICATIONS_ENDPOINT = "/chat-page-api/notifications";

/** The chat the chat page shows now; `null` while no chat page is open. */
let openedChatId: string | null = null;

/** Recognizes the directory returned by the chat page endpoint. */
export function isChatDirectory(value: unknown): value is VirtualChatDirectory {
  return (
    typeof value === "object" &&
    value !== null &&
    "participants" in value &&
    Array.isArray(value.participants) &&
    "groups" in value &&
    Array.isArray(value.groups) &&
    "contactChoices" in value &&
    Array.isArray(value.contactChoices) &&
    "histories" in value &&
    typeof value.histories === "object" &&
    value.histories !== null
  );
}

/**
 * Notes the chat the chat page shows, so the next reading of the page holds
 * its history.
 * @param chatId - The ID of the opened participant or group; `null` when the
 * page closes.
 */
export function rememberOpenedChat(chatId: string | null): void {
  openedChatId = chatId;
}

/**
 * The address that reads the chat page with the history of the chats it
 * opens: the chat a link names and the chat the page shows now. Without
 * either the server reads the history of the chat used last.
 * @param pageUrl - The address of the chat page being loaded.
 */
export function chatPageEndpoint(pageUrl: string): string {
  const params = new URL(pageUrl).searchParams;
  const kind = params.get("kind");
  const linkedId =
    kind === "group" || kind === "participant" ? params.get("id") : null;
  const query = new URLSearchParams();
  for (const id of new Set([linkedId, openedChatId]))
    if (id) query.append("chat", id);
  const search = query.toString();
  return search === "" ? CHAT_PAGE_ENDPOINT : `${CHAT_PAGE_ENDPOINT}?${search}`;
}
