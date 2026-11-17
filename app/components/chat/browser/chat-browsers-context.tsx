import { createContext, use } from "react";

import { useChatBrowser } from "./use-chat-browser";

import type { ChatBrowsers } from "./use-chat-browser";

const ChatBrowsersContext = createContext<ChatBrowsers | null>(null);

interface ChatBrowsersProviderProps {
  /** Whether the page is open; a closed one reads nothing. */
  readonly isOpen: boolean;
  readonly children: React.ReactNode;
}

/**
 * Reads the operator browsers once for everything below it: the chat list shows
 * a globe for each chat that owns one, and the open chat shows its own.
 */
export function ChatBrowsersProvider({
  isOpen,
  children,
}: ChatBrowsersProviderProps): React.ReactElement {
  const browsers = useChatBrowser(isOpen);
  return <ChatBrowsersContext value={browsers}>{children}</ChatBrowsersContext>;
}

/** The browsers of the surrounding provider; `null` where none reads them. */
export function useChatBrowsers(): ChatBrowsers | null {
  return use(ChatBrowsersContext);
}
