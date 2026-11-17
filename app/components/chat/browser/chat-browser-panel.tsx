import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { browsersOfChat } from "./chat-browser-chat";
import { ChatBrowserEntry } from "./chat-browser-entry";
import { useChatBrowsers } from "./chat-browsers-context";

interface ChatBrowserPanelProps {
  /**
   * The chat sessions of the open chat: the session of an agent in a direct
   * chat, the sessions of the agents of a group, or the session of Pica.
   */
  readonly chatSessionIds: readonly string[];
  /** The browser the split view shows; its row steps aside while it is open. */
  readonly besideBrowserId?: string | null;
  /** Opens a browser in the split view; absent where the chat has none. */
  readonly onOpenBeside?: (browserId: string) => void;
  /** Spacing to the neighbours, which the place of the chat decides. */
  readonly className?: string;
}

/**
 * The operator browsers of the open chat: for each a slim preview row with the
 * shrunk live picture, its address, state and buttons.
 * @remarks
 * It shows only browsers opened in this chat, nothing for a browser without a
 * chat, and nothing at all for a person who is no administrator. A browser
 * that ended is gone at once.
 */
export function ChatBrowserPanel({
  chatSessionIds,
  besideBrowserId = null,
  onOpenBeside,
  className,
}: ChatBrowserPanelProps): React.ReactElement | null {
  const { t } = useTranslation();
  const controller = useChatBrowsers();
  if (!controller) return null;
  const shown = browsersOfChat(controller.browsers, chatSessionIds).filter(
    (browser) => browser.browserId !== besideBrowserId,
  );
  if (shown.length === 0) return null;
  return (
    <section
      aria-label={t("chat.browser.label")}
      className={cn("shrink-0", className)}
    >
      <ul className="space-y-2">
        {shown.map((browser) => (
          <ChatBrowserEntry
            key={browser.browserId}
            browser={browser}
            controller={controller}
            onOpenBeside={onOpenBeside}
          />
        ))}
      </ul>
    </section>
  );
}
