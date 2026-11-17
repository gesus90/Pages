import { ChevronUp } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";

import { ChatBrowserAddress } from "./chat-browser-address";

import type { PicaBrowserView } from "@/definition/PicaBrowser";

interface ChatBrowserCollapsedRowProps {
  readonly browser: PicaBrowserView;
  readonly onExpand: () => void;
}

/**
 * The slim row of a folded browser: 40 px high, address and state, no picture.
 * @remarks
 * It mounts no picture, so a folded browser reads no frames from the server.
 */
export function ChatBrowserCollapsedRow({
  browser,
  onExpand,
}: ChatBrowserCollapsedRowProps): React.ReactElement {
  const { t } = useTranslation();
  return (
    <div className="flex h-10 items-center gap-2 rounded-[14px] border border-border bg-surface px-3 whitespace-nowrap">
      <ChatBrowserAddress browser={browser} />
      <Button
        size="icon-sm"
        variant="ghost"
        className="size-7 min-h-7 xl:min-h-7"
        aria-expanded={false}
        aria-label={t("chat.browser.expand")}
        title={t("chat.browser.expand")}
        onClick={onExpand}
      >
        <ChevronUp aria-hidden="true" className="size-4" />
      </Button>
    </div>
  );
}
