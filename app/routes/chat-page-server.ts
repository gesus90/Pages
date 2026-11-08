import { EMPTY_CHAT_DIRECTORY } from "@/app/components/chat-page/chat-page-directory";

import type { VirtualChatDirectory } from "@/definition/VirtualChat";

/**
 * Loads the chat page for every signed-in account; the workspace frame
 * applies the authentication.
 *
 * @remarks
 * Answers an empty directory until a later ticket stores participants,
 * groups and histories.
 */
export function loader(): VirtualChatDirectory {
  return EMPTY_CHAT_DIRECTORY;
}
