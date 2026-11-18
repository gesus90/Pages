import { backendRequestHeaders } from "@/app/lib/backend-request";

import type { VirtualChatSelection } from "@/definition/VirtualChat";

const VIEW_ENDPOINT = "/chat-page-api/view";

/**
 * Sends a change of the view with `keepalive`, so it still arrives when the
 * person leaves the page or closes the tab right after it.
 */
function sendViewChange(change: Readonly<Record<string, unknown>>): void {
  void fetch(VIEW_ENDPOINT, {
    method: "POST",
    headers: backendRequestHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(change),
    keepalive: true,
  }).catch(() => undefined);
}

/**
 * Stores the chat the person opened, so `/chat` reopens it.
 * @param selection - The opened group or participant.
 */
export function saveLastChat(selection: VirtualChatSelection): void {
  sendViewChange({
    type: "last-chat",
    kind: selection.kind,
    id: selection.id,
  });
}

/**
 * Stores where the person stopped reading in a chat.
 * @param chatKey - The key of the chat, such as `group:…`.
 * @param messageId - The message at the top of the history, or `null` when the
 * history is read to its end.
 */
export function saveReadingPosition(
  chatKey: string,
  messageId: string | null,
): void {
  sendViewChange({ type: "reading-position", chatKey, messageId });
}
