import { Hand, Pause, Square } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import type { PicaBrowserState } from "@/definition/PicaBrowser";

interface StateStyle {
  /** Border, background and text color of the badge; static, so Tailwind finds the classes. */
  readonly className: string;
  /** Background of the 18 px tile in front of the word. */
  readonly tileClassName: string;
  /** The symbol inside the tile. */
  readonly symbol: React.ReactElement;
}

/**
 * Color and symbol of each state, so the state never rests on color alone.
 * A running browser shows a dot that pulses softly; it stands still for a
 * reader who asked for less motion.
 */
const STATE_STYLES: Readonly<Record<PicaBrowserState, StateStyle>> = {
  running: {
    className: "border-success-dot bg-success-subtle text-success",
    tileClassName: "bg-success-dot/24",
    symbol: (
      <span className="size-1.5 rounded-full bg-success-dot motion-safe:animate-pulse" />
    ),
  },
  paused: {
    className: "border-warning bg-warning-subtle text-warning",
    tileClassName: "bg-warning/24",
    symbol: <Pause className="size-3" />,
  },
  takeover: {
    className: "border-info bg-info-subtle text-info",
    tileClassName: "bg-info/24",
    symbol: <Hand className="size-3" />,
  },
  stopped: {
    className: "border-border bg-muted text-muted-foreground",
    tileClassName: "bg-muted-foreground/24",
    symbol: <Square className="size-3" />,
  },
};

/**
 * The badge of a browser's state: a tile with the symbol of the state and the word.
 * @remarks
 * 24 px high with a 1 px border and a 7 px radius; the 18 px tile with a 5 px
 * radius sits 2 px from the top, bottom and left edge and 6 px before the
 * word, like the model badge. The word stays in every state, so the color
 * never carries the meaning alone.
 */
export function ChatBrowserStateBadge({
  state,
}: {
  readonly state: PicaBrowserState;
}): React.ReactElement {
  const { t } = useTranslation();
  const { className, tileClassName, symbol } = STATE_STYLES[state];
  return (
    <span
      data-browser-state={state}
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-[7px] border py-0.5 pr-2 pl-0.5 text-[11px] leading-none font-semibold whitespace-nowrap",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "flex size-[18px] shrink-0 items-center justify-center rounded-[5px]",
          tileClassName,
        )}
      >
        {symbol}
      </span>
      {t(`chat.browser.state.${state}`)}
    </span>
  );
}
