import { useLoaderData } from "react-router";

import { ChatPage } from "@/app/components/chat-page/chat-page";
import { CHAT_PAGE_SAMPLE } from "@/app/components/chat-page/chat-page-sample";

import type { VirtualChatDirectory } from "@/definition/VirtualChat";

/**
 * Reads the participants, groups and histories of the chat page.
 *
 * @remarks
 * PAGE-254 answers them from the fixed sample source in the browser; there is
 * no data endpoint yet. A later ticket replaces only this source.
 */
export function clientLoader(): VirtualChatDirectory {
  return CHAT_PAGE_SAMPLE;
}

/** Renders the chat page with virtual participants and groups. */
export default function ChatPageRoute(): React.ReactElement {
  return <ChatPage directory={useLoaderData<typeof clientLoader>()} />;
}
