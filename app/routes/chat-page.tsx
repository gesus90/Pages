import { useLoaderData } from "react-router";

import { ChatPage } from "@/app/components/chat-page/chat-page";
import { EMPTY_CHAT_DIRECTORY } from "@/app/components/chat-page/chat-page-directory";

import type { VirtualChatDirectory } from "@/definition/VirtualChat";

/**
 * Reads the participants, groups and histories of the chat page.
 *
 * @remarks
 * Answers the empty directory in the browser; there is no data endpoint yet.
 * A later ticket replaces only this source with stored data.
 */
export function clientLoader(): VirtualChatDirectory {
  return EMPTY_CHAT_DIRECTORY;
}

/** Renders the chat page with virtual participants and groups. */
export default function ChatPageRoute(): React.ReactElement {
  return <ChatPage directory={useLoaderData<typeof clientLoader>()} />;
}
