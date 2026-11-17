import { Globe } from "lucide-react";
import { useTranslation } from "react-i18next";

import { ChatBrowserStateBadge } from "./chat-browser-state-badge";

import type { PicaBrowserView } from "@/definition/PicaBrowser";

/** The globe, the address of the page and the state badge of a browser, cut off with an ellipsis. */
export function ChatBrowserAddress({
  browser,
}: {
  readonly browser: PicaBrowserView;
}): React.ReactElement {
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
      <ChatBrowserStateBadge state={browser.state} />
    </div>
  );
}
