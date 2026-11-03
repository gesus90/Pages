import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { useChatBrowserFrame } from "./use-chat-browser-frame";
import { useTakeoverInput } from "./use-takeover-input";

import type {
  PicaBrowserInput,
  PicaBrowserView,
} from "@/definition/PicaBrowser";

interface ChatBrowserStageProps {
  readonly browser: PicaBrowserView;
  /** Whether the picture is on screen; a hidden stage fetches nothing. */
  readonly isWatching: boolean;
  readonly onInput: (input: PicaBrowserInput) => void;
  /** Caps the picture's height, such as `56dvh`; its width follows the page's proportions. */
  readonly maximumHeight?: string;
  readonly className?: string;
}

/**
 * The live picture of an operator browser. While the administrator has the
 * controls, clicks, scrolling and typing over it go to the page.
 */
export function ChatBrowserStage({
  browser,
  isWatching,
  onInput,
  maximumHeight,
  className,
}: ChatBrowserStageProps): React.ReactElement {
  const { t } = useTranslation();
  const source = useChatBrowserFrame(browser.browserId, isWatching);
  const isTakeover = browser.state === "takeover";
  const handlers = useTakeoverInput(onInput, {
    width: browser.width,
    height: browser.height,
  });
  return (
    <div
      // The picture is the page itself; typing needs focus, so the stage is a focusable region only in a takeover.
      role={isTakeover ? "application" : "img"}
      aria-label={t(
        isTakeover ? "chat.browser.stageControl" : "chat.browser.stage",
        {
          url: browser.url,
        },
      )}
      tabIndex={isTakeover ? 0 : -1}
      style={{
        aspectRatio: `${browser.width} / ${browser.height}`,
        ...(maximumHeight
          ? {
              width: `min(100%, calc(${maximumHeight} * ${browser.width / browser.height}))`,
            }
          : {}),
      }}
      className={cn(
        "relative mx-auto w-full overflow-hidden rounded-lg border border-border bg-muted outline-none",
        isTakeover &&
          "cursor-crosshair ring-2 ring-primary focus-visible:ring-offset-2",
        className,
      )}
      {...(isTakeover ? handlers : {})}
    >
      {source ? (
        <img
          alt=""
          src={source}
          draggable={false}
          className="size-full select-none object-fill"
        />
      ) : (
        <p className="absolute inset-0 grid place-items-center text-xs text-muted-foreground">
          {t("chat.browser.loading")}
        </p>
      )}
    </div>
  );
}
