import { useTranslation } from "react-i18next";

import { ChatBrowserCard } from "./chat-browser-card";
import { useChatBrowser } from "./use-chat-browser";

interface ChatBrowserPanelProps {
  readonly isOpen: boolean;
}

/**
 * Pica's operator browsers in the chat (PAGE-181): the live picture of the page, its address, the
 * actions taken and the controls to pause, stop or take over.
 *
 * @remarks
 * It shows nothing for a person without a browser, and nothing at all for a
 * person who is no administrator.
 */
export function ChatBrowserPanel({
  isOpen,
}: ChatBrowserPanelProps): React.ReactElement | null {
  const { t } = useTranslation();
  const controller = useChatBrowser(isOpen);
  if (controller.browsers.length === 0) return null;
  return (
    <section
      aria-label={t("chat.browser.label")}
      className="max-h-[60%] shrink-0 overflow-y-auto border-t border-border bg-background px-3 py-2"
    >
      <ul className="space-y-2">
        {controller.browsers.map((browser) => (
          <ChatBrowserCard
            key={browser.browserId}
            browser={browser}
            controller={controller}
          />
        ))}
      </ul>
    </section>
  );
}
