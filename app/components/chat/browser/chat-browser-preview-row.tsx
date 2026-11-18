import {
  ChevronDown,
  Maximize2,
  PanelRight,
  Pause,
  Play,
  Square,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { cn } from "@/app/lib/cn";

import { useChatElapsed } from "../use-chat-elapsed";

import { ChatBrowserAddress } from "./chat-browser-address";
import { formatBrowserElapsed } from "./chat-browser-chat";
import { ChatBrowserStateBadge } from "./chat-browser-state-badge";
import { ChatBrowserThumbnail } from "./chat-browser-thumbnail";

import type { ChatBrowsers } from "./use-chat-browser";
import type { PicaBrowserView } from "@/definition/PicaBrowser";

interface ChatBrowserPreviewRowProps {
  readonly browser: PicaBrowserView;
  readonly controller: ChatBrowsers;
  /** Whether the picture is on screen; the enlarged view takes over the stream. */
  readonly isWatching: boolean;
  /** Opens the browser beside the chat; absent where there is no split view. */
  readonly onOpenBeside: (() => void) | undefined;
  readonly onEnlarge: () => void;
  readonly onCollapse: () => void;
}

/** The radius of the row's buttons, 8 px like the picture. */
const BUTTON_RADIUS = "rounded-md";

/** The three lines right of the picture: address, last action, tools and running time. */
function PreviewLines({
  browser,
  error,
}: {
  readonly browser: PicaBrowserView;
  readonly error: string | null;
}): React.ReactElement {
  const { t } = useTranslation();
  const seconds = useChatElapsed(Date.parse(browser.startedAt), true);
  const lastAction = browser.actions.at(-1);
  return (
    <div className="flex min-w-0 flex-1 flex-col justify-center">
      <div className="flex h-6 items-center">
        <ChatBrowserAddress browser={browser} showState={false} />
      </div>
      <p className="h-4 truncate text-xs leading-4 text-muted-foreground">
        {lastAction?.summary ?? t("chat.browser.noActions")}
      </p>
      {error ? (
        <p
          role="alert"
          className="h-4 truncate text-xs leading-4 text-destructive"
        >
          {t([
            `chat.browser.errors.${error}`,
            "chat.browser.errors.BROWSER_FAILED",
          ])}
        </p>
      ) : (
        <p className="h-4 truncate text-xs leading-4 text-muted-foreground tabular-nums">
          {t("chat.browser.summary", {
            count: browser.actionCount,
            duration: formatBrowserElapsed(seconds),
          })}
        </p>
      )}
    </div>
  );
}

/** The 1 × 24 px line between two groups; it keeps 10 px on both sides and stands in the middle of the row. */
function RowDivider(): React.ReactElement {
  return (
    <span aria-hidden="true" className="mx-2.5 h-6 w-px shrink-0 bg-border" />
  );
}

/** Pause or resume in one place; during a takeover and after the stop the button stays and waits. */
function PauseButton({
  browser,
  controller,
}: Pick<
  ChatBrowserPreviewRowProps,
  "browser" | "controller"
>): React.ReactElement {
  const { t } = useTranslation();
  const isPaused = browser.state === "paused";
  const label = t(isPaused ? "chat.browser.resume" : "chat.browser.pause");
  return (
    <Button
      size="icon-sm"
      variant="outline"
      className={BUTTON_RADIUS}
      aria-label={label}
      title={label}
      disabled={browser.state === "takeover" || browser.state === "stopped"}
      onClick={() =>
        void controller.command(browser.browserId, {
          command: isPaused ? "resume" : "pause",
        })
      }
    >
      {isPaused ? (
        <Play aria-hidden="true" className="size-4" />
      ) : (
        <Pause aria-hidden="true" className="size-4" />
      )}
    </Button>
  );
}

/** The control group: pause or resume, and stop. */
function ControlGroup({
  browser,
  controller,
}: Pick<
  ChatBrowserPreviewRowProps,
  "browser" | "controller"
>): React.ReactElement {
  const { t } = useTranslation();
  return (
    <div className="flex shrink-0 items-center gap-1">
      <PauseButton browser={browser} controller={controller} />
      <Button
        size="icon-sm"
        variant="destructive-soft"
        className={BUTTON_RADIUS}
        aria-label={t("chat.browser.stop")}
        title={t("chat.browser.stop")}
        disabled={browser.state === "stopped"}
        onClick={() =>
          void controller.command(browser.browserId, { command: "stop" })
        }
      >
        <Square aria-hidden="true" className="size-4" />
      </Button>
    </div>
  );
}

/** The view group: open beside the chat where there is room, enlarge, and fold. */
function ViewGroup({
  onOpenBeside,
  onEnlarge,
  onCollapse,
}: Pick<
  ChatBrowserPreviewRowProps,
  "onOpenBeside" | "onEnlarge" | "onCollapse"
>): React.ReactElement {
  const { t } = useTranslation();
  return (
    <div className="flex shrink-0 items-center gap-1">
      {onOpenBeside ? (
        <Button
          size="icon-sm"
          variant="outline"
          className={cn(BUTTON_RADIUS, "max-[1100px]:hidden")}
          aria-label={t("chat.browser.openBeside")}
          title={t("chat.browser.openBeside")}
          onClick={onOpenBeside}
        >
          <PanelRight aria-hidden="true" className="size-4" />
        </Button>
      ) : null}
      <Button
        size="icon-sm"
        variant="outline"
        className={BUTTON_RADIUS}
        aria-label={t("chat.browser.enlarge")}
        title={t("chat.browser.enlarge")}
        onClick={onEnlarge}
      >
        <Maximize2 aria-hidden="true" className="size-4" />
      </Button>
      <Button
        size="icon-sm"
        variant="outline"
        className={BUTTON_RADIUS}
        aria-expanded
        aria-label={t("chat.browser.collapse")}
        title={t("chat.browser.collapse")}
        onClick={onCollapse}
      >
        <ChevronDown aria-hidden="true" className="size-4" />
      </Button>
    </div>
  );
}

/**
 * The row of a browser in its chat: a 88 px high strip between the history and
 * the input with the shrunk live picture, three lines of facts, the state
 * badge and the buttons.
 * @remarks
 * Every size is fixed, so neither a new state nor a new log entry moves the
 * input below it. The padding is 8 px on all four sides, the parts stand 12 px
 * apart and on the centre line, and the two groups of buttons are set apart
 * by a divider each.
 */
export function ChatBrowserPreviewRow({
  browser,
  controller,
  isWatching,
  onOpenBeside,
  onEnlarge,
  onCollapse,
}: ChatBrowserPreviewRowProps): React.ReactElement {
  return (
    <div className="flex h-22 items-center gap-3 rounded-[14px] border border-border bg-surface p-2 whitespace-nowrap">
      <ChatBrowserThumbnail browser={browser} isWatching={isWatching} />
      <PreviewLines browser={browser} error={controller.error} />
      <div className="flex shrink-0 items-center">
        <ChatBrowserStateBadge state={browser.state} />
        <RowDivider />
        <ControlGroup browser={browser} controller={controller} />
        <RowDivider />
        <ViewGroup
          onOpenBeside={onOpenBeside}
          onEnlarge={onEnlarge}
          onCollapse={onCollapse}
        />
      </div>
    </div>
  );
}
