import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { useChatBrowserFrame } from "./use-chat-browser-frame";

import type { PicaBrowserView } from "@/definition/PicaBrowser";

/** The height of the picture in the preview row; a desktop page is 16:10, a phone page stands upright. */
const THUMBNAIL_HEIGHT = 70;

interface ChatBrowserThumbnailProps {
  readonly browser: PicaBrowserView;
  /** Whether the picture is on screen; a hidden one fetches nothing. */
  readonly isWatching: boolean;
}

/**
 * The live picture of a browser, shrunk to 112 × 70 px, or 70 px high for a phone page.
 * @remarks
 * It follows the same picture as the enlarged view, so only one of them
 * reads from the server at a time.
 */
export function ChatBrowserThumbnail({
  browser,
  isWatching,
}: ChatBrowserThumbnailProps): React.ReactElement {
  const { t } = useTranslation();
  const source = useChatBrowserFrame(browser.browserId, isWatching);
  const isUpright = browser.device === "mobile";
  return (
    <div
      role="img"
      aria-label={t("chat.browser.preview", { url: browser.url })}
      // A phone page keeps its proportions, so its width follows the page.
      style={
        isUpright
          ? {
              width: Math.round(
                (THUMBNAIL_HEIGHT * browser.width) / browser.height,
              ),
            }
          : undefined
      }
      className={cn(
        "h-17.5 shrink-0 overflow-hidden rounded-md border border-border bg-muted",
        !isUpright && "w-28",
      )}
    >
      {source ? (
        <img
          alt=""
          src={source}
          draggable={false}
          className="size-full select-none object-cover object-top"
        />
      ) : null}
    </div>
  );
}
