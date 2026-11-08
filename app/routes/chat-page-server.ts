import { CHAT_PAGE_SAMPLE } from "@/app/components/chat-page/chat-page-sample";

import type { VirtualChatDirectory } from "@/definition/VirtualChat";

/**
 * Loads the chat page for every signed-in account; the workspace frame
 * applies the authentication.
 *
 * @remarks
 * PAGE-254 answers the fixed sample source; storage follows in a later ticket.
 */
export function loader(): VirtualChatDirectory {
  return CHAT_PAGE_SAMPLE;
}
