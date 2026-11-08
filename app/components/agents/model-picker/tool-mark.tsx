import { Bot } from "lucide-react";

import { cn } from "@/app/lib/cn";

/*
 * Branding note: these are the app icons of the tools a model choice lists,
 * used only to name them beside their written name. The files are the ones
 * attached to PAGE-248, kept unchanged in `assets/providers/` and only scaled
 * here; the trademarks stay with their owners. `no-inline` keeps each a file
 * of its own, so the browser caches it once instead of finding it as a data
 * URL in every server-rendered page.
 */
import antigravityUrl from "@/assets/providers/page248-logo-antigravity.png?no-inline";
import chatgptUrl from "@/assets/providers/page248-logo-chatgpt.png?no-inline";
import claudeUrl from "@/assets/providers/page248-logo-claude.png?no-inline";
import opencodeUrl from "@/assets/providers/page248-logo-opencode.svg?no-inline";
import openrouterUrl from "@/assets/providers/page248-logo-openrouter.png?no-inline";
import zaiUrl from "@/assets/providers/page248-logo-zai.png?no-inline";

/** The common frame of every mark: a 20 × 20 tile with a 5 px radius. */
const TILE_CLASS =
  "inline-flex size-5 shrink-0 items-center justify-center overflow-hidden rounded-[5px]";

interface ToolMarkImage {
  readonly src: string;
  /** The tile behind an icon that is no tile of its own; the vendor's white. */
  readonly tileClassName?: string;
  readonly imageClassName?: string;
}

// Antigravity's arch sits on a wide transparent margin, so it is enlarged
// until it fills the tile like the others; OpenCode's mark keeps a thin rim.
const TOOL_MARKS: Readonly<Record<string, ToolMarkImage>> = {
  claude: { src: claudeUrl },
  openai: { src: chatgptUrl },
  antigravity: {
    src: antigravityUrl,
    tileClassName: "bg-white",
    imageClassName: "scale-[1.7] object-contain",
  },
  opencode: {
    src: opencodeUrl,
    tileClassName: "bg-white p-[1.5px]",
    imageClassName: "object-contain",
  },
  openrouter: { src: openrouterUrl },
  zai: { src: zaiUrl },
};

/**
 * Whether a mark key has a vendor icon of its own.
 *
 * @param mark - A key such as `claude` or `opencode`.
 * @returns `false` for a key that shows the neutral mark.
 */
export function hasToolMark(mark: string): boolean {
  return Object.hasOwn(TOOL_MARKS, mark);
}

/**
 * The app icon of a tool or provider as a uniform 20 × 20 tile.
 *
 * @remarks
 * Every icon fills the same tile with the same radius, so the marks look
 * equally large and the names beside them start in one column. The written
 * name always stands beside the mark, so the mark is hidden from assistive
 * technology. A tool registered without an icon gets the neutral mark on a
 * tile of the theme, so a new runner needs no change here.
 */
export function ToolMark({
  mark,
  className,
}: {
  /** A key such as `claude`, `openai`, `opencode`, `openrouter`, `zai` or `antigravity`. */
  readonly mark: string;
  readonly className?: string;
}): React.ReactElement {
  const image: ToolMarkImage | undefined = TOOL_MARKS[mark];
  if (!image)
    return (
      <span
        aria-hidden="true"
        className={cn(TILE_CLASS, "bg-muted text-muted-foreground", className)}
      >
        <Bot className="size-3.5" strokeWidth={2} />
      </span>
    );
  return (
    <span
      aria-hidden="true"
      className={cn(TILE_CLASS, image.tileClassName, className)}
    >
      <img
        alt=""
        src={image.src}
        width={20}
        height={20}
        draggable={false}
        className={cn("size-full object-cover", image.imageClassName)}
      />
    </span>
  );
}
