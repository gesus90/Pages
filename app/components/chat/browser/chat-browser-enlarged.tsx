import { useTranslation } from "react-i18next";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/app/components/ui/dialog";

import { ChatBrowserActions } from "./chat-browser-actions";
import { ChatBrowserControls } from "./chat-browser-controls";
import { ChatBrowserExtras } from "./chat-browser-extras";
import { ChatBrowserStage } from "./chat-browser-stage";

import type { ChatBrowsers } from "./use-chat-browser";
import type {
  PicaBrowserInput,
  PicaBrowserView,
} from "@/definition/PicaBrowser";

interface ChatBrowserEnlargedProps {
  readonly browser: PicaBrowserView;
  readonly controller: ChatBrowsers;
  readonly isOpen: boolean;
  readonly onOpenChange: (isOpen: boolean) => void;
  readonly onInput: (input: PicaBrowserInput) => void;
}

/** The enlarged live view of a browser with its actions, controls and options. */
export function ChatBrowserEnlarged({
  browser,
  controller,
  isOpen,
  onOpenChange,
  onInput,
}: ChatBrowserEnlargedProps): React.ReactElement {
  const { t } = useTranslation();
  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(72rem,94vw)] space-y-3">
        <DialogTitle className="truncate text-base font-semibold">
          {browser.title || browser.url || t("chat.browser.blank")}
        </DialogTitle>
        <DialogDescription className="sr-only">
          {t("chat.browser.enlargedDescription")}
        </DialogDescription>
        {isOpen ? (
          <ChatBrowserStage
            browser={browser}
            isWatching
            onInput={onInput}
            maximumHeight="56dvh"
          />
        ) : null}
        <ChatBrowserActions actions={browser.actions} />
        <ChatBrowserControls browser={browser} controller={controller} />
        <ChatBrowserExtras browser={browser} controller={controller} />
      </DialogContent>
    </Dialog>
  );
}
