import { Maximize2, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { cn } from "@/app/lib/cn";

import { ChatBrowserActions } from "./chat-browser-actions";
import { ChatBrowserAddress } from "./chat-browser-address";
import { ChatBrowserControls } from "./chat-browser-controls";
import { ChatBrowserEnlarged } from "./chat-browser-enlarged";
import { ChatBrowserExtras } from "./chat-browser-extras";
import { ChatBrowserStage } from "./chat-browser-stage";

import type { ChatBrowsers } from "./use-chat-browser";
import type {
  PicaBrowserInput,
  PicaBrowserView,
} from "@/definition/PicaBrowser";

interface ChatBrowserSidePanelProps {
  readonly browser: PicaBrowserView;
  readonly controller: ChatBrowsers;
  readonly onClose: () => void;
  readonly className?: string;
  readonly style?: React.CSSProperties;
}

/** The hint of a takeover: why Pica asks for the controls, or how to use them. */
function TakeoverHint({
  browser,
}: {
  readonly browser: PicaBrowserView;
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (browser.state !== "takeover") return null;
  return (
    <p
      role="status"
      className="mx-3 mb-2 shrink-0 rounded-lg bg-info-subtle px-2 py-1.5 text-xs text-info"
    >
      {browser.handoverReason
        ? t("chat.browser.handoverAsked", { reason: browser.handoverReason })
        : t("chat.browser.takeoverHint")}
    </p>
  );
}

/** The options and a failed control below the log; they scroll when they grow. */
function PanelNotes({
  browser,
  controller,
}: {
  readonly browser: PicaBrowserView;
  readonly controller: ChatBrowsers;
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (browser.state === "stopped" && !controller.error) return null;
  return (
    <div className="max-h-40 shrink-0 space-y-2 overflow-y-auto px-3 pb-2">
      <ChatBrowserExtras browser={browser} controller={controller} />
      {controller.error ? (
        <p role="alert" className="text-xs text-destructive">
          {t([
            `chat.browser.errors.${controller.error}`,
            "chat.browser.errors.BROWSER_FAILED",
          ])}
        </p>
      ) : null}
    </div>
  );
}

/**
 * One browser in the split view beside the chat: a 52 px head with address,
 * state, enlarge and close, the live picture over the full width, the log
 * that takes the rest, and a 56 px strip with the controls.
 * @remarks
 * The frame around it, its width and its divider belong to the split view.
 */
export function ChatBrowserSidePanel({
  browser,
  controller,
  onClose,
  className,
  style,
}: ChatBrowserSidePanelProps): React.ReactElement {
  const { t } = useTranslation();
  const [isEnlarged, setIsEnlarged] = useState(false);

  function relay(input: PicaBrowserInput): void {
    void controller.command(browser.browserId, { command: "input", input });
  }

  return (
    <section
      aria-label={t("chat.browser.label")}
      className={cn(
        "@container flex min-h-0 min-w-0 flex-col overflow-hidden bg-surface text-foreground",
        className,
      )}
      style={style}
    >
      <header className="flex h-13 shrink-0 items-center gap-2 border-b border-border px-3">
        <ChatBrowserAddress browser={browser} />
        <Button
          size="icon-sm"
          variant="outline"
          aria-label={t("chat.browser.enlarge")}
          title={t("chat.browser.enlarge")}
          onClick={() => setIsEnlarged(true)}
        >
          <Maximize2 aria-hidden="true" className="size-4" />
        </Button>
        <Button
          size="icon-sm"
          variant="outline"
          aria-label={t("chat.browser.closePanel")}
          title={t("chat.browser.closePanel")}
          onClick={onClose}
        >
          <X aria-hidden="true" className="size-4" />
        </Button>
      </header>
      <div className="shrink-0 p-3">
        <ChatBrowserStage
          browser={browser}
          isWatching={!isEnlarged}
          onInput={relay}
          maximumHeight="50dvh"
        />
      </div>
      <TakeoverHint browser={browser} />
      <ChatBrowserActions
        actions={browser.actions}
        className="min-h-0 max-h-none flex-1 border-t border-border px-3 py-2"
      />
      <PanelNotes browser={browser} controller={controller} />
      <footer className="flex h-14 shrink-0 items-center border-t border-border px-3">
        <ChatBrowserControls
          browser={browser}
          controller={controller}
          className="flex-nowrap"
        />
      </footer>
      <ChatBrowserEnlarged
        browser={browser}
        controller={controller}
        isOpen={isEnlarged}
        onOpenChange={setIsEnlarged}
        onInput={relay}
      />
    </section>
  );
}
