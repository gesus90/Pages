import { Globe } from "lucide-react";
import { useTranslation } from "react-i18next";

import { ChatBrowserStateBadge } from "./chat-browser-state-badge";

import type { PicaBrowserView } from "@/definition/PicaBrowser";

interface ChatBrowserAddressProps {
  readonly browser: PicaBrowserView;
  /** Whether the state badge ends the line; the preview row shows it in a place of its own. */
  readonly showState?: boolean;
}

/** The globe and the address of the page, cut off with an ellipsis, and by default the state badge of a browser. */
export function ChatBrowserAddress({
  browser,
  showState = true,
}: ChatBrowserAddressProps): React.ReactElement {
  const { t } = useTranslation();
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2 whitespace-nowrap">
      <Globe
        aria-hidden="true"
        className="size-4 shrink-0 text-muted-foreground"
      />
      <p
        className="min-w-0 flex-1 truncate text-[13px] font-medium"
        title={browser.url}
        aria-label={t("chat.browser.address")}
      >
        {browser.url || t("chat.browser.blank")}
      </p>
      {showState ? <ChatBrowserStateBadge state={browser.state} /> : null}
    </div>
  );
}
