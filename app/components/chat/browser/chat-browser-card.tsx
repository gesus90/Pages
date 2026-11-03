import { ChevronDown, ChevronUp, Globe, Maximize2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/app/components/ui/dialog";
import { cn } from "@/app/lib/cn";

import { ChatBrowserActions } from "./chat-browser-actions";
import { ChatBrowserControls } from "./chat-browser-controls";
import { ChatBrowserExtras } from "./chat-browser-extras";
import { ChatBrowserStage } from "./chat-browser-stage";

import type { ChatBrowsers } from "./use-chat-browser";
import type {
  PicaBrowserInput,
  PicaBrowserView,
} from "@/definition/PicaBrowser";

interface ChatBrowserCardProps {
  readonly browser: PicaBrowserView;
  readonly controller: ChatBrowsers;
}

const STATE_STYLES: Readonly<Record<PicaBrowserView["state"], string>> = {
  running: "bg-success-subtle text-success",
  paused: "bg-warning-subtle text-warning",
  takeover: "bg-info-subtle text-info",
  stopped: "bg-muted text-muted-foreground",
};

interface ChatBrowserHeaderProps {
  readonly browser: PicaBrowserView;
  readonly isCollapsed: boolean;
  readonly onEnlarge: () => void;
  readonly onToggle: () => void;
}

/** The address, the state and the enlarge and collapse buttons of one browser. */
function ChatBrowserHeader({
  browser,
  isCollapsed,
  onEnlarge,
  onToggle,
}: ChatBrowserHeaderProps): React.ReactElement {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2">
      <Globe
        aria-hidden="true"
        className="size-4 shrink-0 text-muted-foreground"
      />
      <p
        className="min-w-0 flex-1 truncate text-xs"
        title={browser.url}
        aria-label={t("chat.browser.address")}
      >
        {browser.url || t("chat.browser.blank")}
      </p>
      <span
        className={cn(
          "shrink-0 rounded-full px-2 py-0.5 text-[0.6875rem] font-medium",
          STATE_STYLES[browser.state],
        )}
      >
        {t(`chat.browser.state.${browser.state}`)}
      </span>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label={t("chat.browser.enlarge")}
        disabled={browser.state === "stopped"}
        onClick={onEnlarge}
      >
        <Maximize2 aria-hidden="true" className="size-4" />
      </Button>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-expanded={!isCollapsed}
        aria-label={t(
          isCollapsed ? "chat.browser.expand" : "chat.browser.collapse",
        )}
        onClick={onToggle}
      >
        {isCollapsed ? (
          <ChevronDown aria-hidden="true" className="size-4" />
        ) : (
          <ChevronUp aria-hidden="true" className="size-4" />
        )}
      </Button>
    </div>
  );
}

interface ChatBrowserEnlargedProps extends ChatBrowserCardProps {
  readonly isOpen: boolean;
  readonly onOpenChange: (isOpen: boolean) => void;
  readonly onInput: (input: PicaBrowserInput) => void;
}

/** The enlarged live view of a browser with its actions and controls. */
function ChatBrowserEnlarged({
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
      </DialogContent>
    </Dialog>
  );
}

/** One operator browser in the chat: state, address, live picture, actions and the controls over it. */
export function ChatBrowserCard({
  browser,
  controller,
}: ChatBrowserCardProps): React.ReactElement {
  const { t } = useTranslation();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isEnlarged, setIsEnlarged] = useState(false);

  function relay(input: PicaBrowserInput): void {
    void controller.command(browser.browserId, { command: "input", input });
  }

  return (
    <li className="space-y-2 rounded-xl border border-border bg-surface p-2.5">
      <ChatBrowserHeader
        browser={browser}
        isCollapsed={isCollapsed}
        onEnlarge={() => setIsEnlarged(true)}
        onToggle={() => setIsCollapsed((current) => !current)}
      />
      {isCollapsed ? null : (
        <>
          {browser.state === "takeover" ? (
            <p
              role="status"
              className="rounded-lg bg-info-subtle px-2 py-1.5 text-xs text-info"
            >
              {browser.handoverReason
                ? t("chat.browser.handoverAsked", {
                    reason: browser.handoverReason,
                  })
                : t("chat.browser.takeoverHint")}
            </p>
          ) : null}
          {browser.state === "stopped" ? (
            <p className="text-xs text-muted-foreground">
              {t("chat.browser.stoppedHint")}
            </p>
          ) : (
            <ChatBrowserStage
              browser={browser}
              isWatching={!isEnlarged}
              onInput={relay}
            />
          )}
          <ChatBrowserActions actions={browser.actions} />
          <ChatBrowserControls browser={browser} controller={controller} />
          <ChatBrowserExtras browser={browser} controller={controller} />
          {controller.error ? (
            <p role="alert" className="text-xs text-destructive">
              {t([
                `chat.browser.errors.${controller.error}`,
                "chat.browser.errors.BROWSER_FAILED",
              ])}
            </p>
          ) : null}
        </>
      )}
      <ChatBrowserEnlarged
        browser={browser}
        controller={controller}
        isOpen={isEnlarged}
        onOpenChange={setIsEnlarged}
        onInput={relay}
      />
    </li>
  );
}
