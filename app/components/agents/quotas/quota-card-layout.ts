import type { ClaudeQuotaTone } from "@/definition/ClaudeQuota";

/*
 * The classes that give a card, its window area and its status line one
 * size whatever they hold: a placeholder card, a card without figures and a
 * card with figures stand on the same lines, so nothing moves when one
 * becomes the other.
 */

/** A card; the grid sets the height, 308 px on a wide screen and 344 px on a phone. */
export const QUOTA_CARD_CLASS =
  "flex h-full min-w-0 flex-col overflow-hidden rounded-[20px] bg-surface px-4 py-4 ring-1 ring-border ring-inset md:rounded-3xl md:px-6 md:py-[22px]";

/**
 * The window area between head and status line: 172 px on a wide card with
 * 15 px above and below and 18 px between the slots, 220 px on a phone with
 * 24 px above and below and 20 px between.
 */
export const QUOTA_WINDOWS_AREA_CLASS =
  "flex min-h-0 flex-1 flex-col justify-center gap-5 overflow-hidden py-6 md:gap-[18px] md:py-[15px]";

/** The slot of one window: 62 px on a wide card, 76 px on a phone. */
export const QUOTA_WINDOW_SLOT_CLASS =
  "flex h-[76px] shrink-0 flex-col gap-2 md:h-[62px]";

/**
 * The window area of a card that lists three windows: the same 172 px on a
 * wide card and 220 px on a phone, with the slots below and less space
 * around and between them, so a third window fits without scrolling.
 */
export const QUOTA_COMPACT_WINDOWS_AREA_CLASS =
  "flex min-h-0 flex-1 flex-col justify-center gap-3 overflow-hidden py-6 md:gap-1.5 md:py-2";

/** The slot of one window of three: 48 px, the same on a wide card and on a phone. */
export const QUOTA_COMPACT_WINDOW_SLOT_CLASS =
  "flex h-12 shrink-0 flex-col gap-px";

/** The status line: 48 px below a 1 px border. */
export const QUOTA_STATUS_LINE_CLASS =
  "flex h-12 shrink-0 items-center gap-3 border-t border-border";

/**
 * The area of the model groups of an Antigravity card between head and status
 * line: 172 px on a wide card with 12 px above and below, 220 px on a phone
 * with 24 px above and below. It clips nothing, because the scroll bar of the
 * group list stands in the padding of the card.
 */
export const QUOTA_GROUPS_AREA_CLASS =
  "flex min-h-0 flex-1 flex-col justify-center py-6 md:py-3";

/** The groups of a card one below the other: 12 px between them, 20 px on a phone. */
export const QUOTA_GROUP_LIST_CLASS = "flex flex-col gap-5 md:gap-3";

/** The slot of one group: 68 px on a wide card, 76 px on a phone. */
export const QUOTA_GROUP_SLOT_CLASS =
  "flex h-[76px] shrink-0 flex-col gap-2 md:h-[68px] md:gap-1.5";

/** The fill of a bar for each tone; static, so Tailwind finds the classes. */
export const QUOTA_BAR_CLASSES: Readonly<Record<ClaudeQuotaTone, string>> = {
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
};

/** How long new figures take to run in, the bar and the number alike. */
export const QUOTA_FIGURES_RUN_MILLISECONDS = 300;

/** The most groups an Antigravity card shows without scrolling. */
export const VISIBLE_GROUPS = 2;
