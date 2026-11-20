import type { ClaudeQuotaTone } from "@/definition/ClaudeQuota";

/*
 * The classes that give a card, its window area and its status line one
 * size whatever they hold: a placeholder card, a card without figures and a
 * card with figures stand on the same lines, so nothing moves when one
 * becomes the other.
 */

/** A card; the grid sets the height, 340 px on a wide screen and 344 px on a phone. */
export const QUOTA_CARD_CLASS =
  "flex h-full min-w-0 flex-col overflow-hidden rounded-[20px] bg-surface px-4 py-4 ring-1 ring-border ring-inset md:rounded-3xl md:px-6 md:py-[22px]";

/** The quota area centers one or two standard windows. */
export const QUOTA_WINDOWS_AREA_CLASS =
  "flex min-h-0 flex-1 flex-col justify-center gap-5 overflow-hidden py-6 md:gap-7 md:py-3";

/** The slot of a standard window. */
export const QUOTA_WINDOW_SLOT_CLASS =
  "flex h-[76px] shrink-0 flex-col md:h-[66px]";

/** The quota area holds three compact windows and scrolls for any extra entries. */
export const QUOTA_COMPACT_WINDOWS_AREA_CLASS =
  "flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto py-3 md:gap-3.5 md:py-1";

/** The slot of a compact window. */
export const QUOTA_COMPACT_WINDOW_SLOT_CLASS =
  "flex h-14 shrink-0 flex-col gap-1.5";

/** The status line: 48 px below a 1 px border. */
export const QUOTA_STATUS_LINE_CLASS =
  "flex h-12 shrink-0 items-center gap-3 border-t border-border";

/** The quota area centers one or two Antigravity model groups. */
export const QUOTA_GROUPS_AREA_CLASS =
  "flex min-h-0 flex-1 flex-col justify-center py-2";

/** Consecutive Antigravity groups have 12 px between them. */
export const QUOTA_GROUP_LIST_CLASS = "flex flex-col gap-3";

/** The slot of an Antigravity group, including the title and forecast line. */
export const QUOTA_GROUP_SLOT_CLASS = "flex h-[88px] shrink-0 flex-col gap-1.5";

/** The fill of a bar for each tone; static, so Tailwind finds the classes. */
export const QUOTA_BAR_CLASSES: Readonly<Record<ClaudeQuotaTone, string>> = {
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
};

/** The most groups an Antigravity card shows without scrolling. */
export const VISIBLE_GROUPS = 2;
