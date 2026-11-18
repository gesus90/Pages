import { cn } from "@/app/lib/cn";
import { isReasoningBadgeLevel } from "@/definition/AgentModelIdentity";

import type { ReasoningBadgeLevel } from "@/definition/AgentModelIdentity";

/** The colors of one reasoning level; static, so Tailwind finds the classes. */
interface ReasoningLevelClasses {
  /** Border, background and text of a badge or a field that shows the level. */
  readonly badge: string;
  /** The unchanged background of a field that shows the level, while it is hovered. */
  readonly fieldHover: string;
  /** Background and sign color of the level's tile. */
  readonly tile: string;
  /** Background and text of the level's row while it is the chosen one. */
  readonly chosenRow: string;
}

/**
 * The colors of each level.
 * @remarks
 * The tiles of `none` to `xhigh` are tinted with 24 % of the level's dot
 * color. The tiles of `max` and `ultra` are filled, `ultra` with a 135°
 * gradient towards `max`, and carry the sign in the surface color, so the
 * two highest levels stand out at a glance.
 */
export const REASONING_LEVEL_CLASSES: Readonly<
  Record<ReasoningBadgeLevel, ReasoningLevelClasses>
> = {
  none: {
    badge:
      "border-reasoning-none-dot bg-reasoning-none-subtle text-reasoning-none",
    fieldHover: "hover:bg-reasoning-none-subtle",
    tile: "bg-reasoning-none-dot/24 text-reasoning-none",
    chosenRow:
      "data-[state=checked]:bg-reasoning-none-subtle data-[state=checked]:text-reasoning-none",
  },
  minimal: {
    badge:
      "border-reasoning-minimal-dot bg-reasoning-minimal-subtle text-reasoning-minimal",
    fieldHover: "hover:bg-reasoning-minimal-subtle",
    tile: "bg-reasoning-minimal-dot/24 text-reasoning-minimal",
    chosenRow:
      "data-[state=checked]:bg-reasoning-minimal-subtle data-[state=checked]:text-reasoning-minimal",
  },
  low: {
    badge:
      "border-reasoning-low-dot bg-reasoning-low-subtle text-reasoning-low",
    fieldHover: "hover:bg-reasoning-low-subtle",
    tile: "bg-reasoning-low-dot/24 text-reasoning-low",
    chosenRow:
      "data-[state=checked]:bg-reasoning-low-subtle data-[state=checked]:text-reasoning-low",
  },
  medium: {
    badge:
      "border-reasoning-medium-dot bg-reasoning-medium-subtle text-reasoning-medium",
    fieldHover: "hover:bg-reasoning-medium-subtle",
    tile: "bg-reasoning-medium-dot/24 text-reasoning-medium",
    chosenRow:
      "data-[state=checked]:bg-reasoning-medium-subtle data-[state=checked]:text-reasoning-medium",
  },
  high: {
    badge:
      "border-reasoning-high-dot bg-reasoning-high-subtle text-reasoning-high",
    fieldHover: "hover:bg-reasoning-high-subtle",
    tile: "bg-reasoning-high-dot/24 text-reasoning-high",
    chosenRow:
      "data-[state=checked]:bg-reasoning-high-subtle data-[state=checked]:text-reasoning-high",
  },
  xhigh: {
    badge:
      "border-reasoning-xhigh-dot bg-reasoning-xhigh-subtle text-reasoning-xhigh",
    fieldHover: "hover:bg-reasoning-xhigh-subtle",
    tile: "bg-reasoning-xhigh-dot/24 text-reasoning-xhigh",
    chosenRow:
      "data-[state=checked]:bg-reasoning-xhigh-subtle data-[state=checked]:text-reasoning-xhigh",
  },
  max: {
    badge:
      "border-reasoning-max-dot bg-reasoning-max-subtle text-reasoning-max",
    fieldHover: "hover:bg-reasoning-max-subtle",
    tile: "bg-reasoning-max-dot text-surface",
    chosenRow:
      "data-[state=checked]:bg-reasoning-max-subtle data-[state=checked]:text-reasoning-max",
  },
  ultra: {
    badge:
      "border-reasoning-ultra-dot bg-reasoning-ultra-subtle text-reasoning-ultra",
    fieldHover: "hover:bg-reasoning-ultra-subtle",
    tile: "bg-linear-135 from-reasoning-ultra-dot to-reasoning-max-dot text-surface",
    chosenRow:
      "data-[state=checked]:bg-reasoning-ultra-subtle data-[state=checked]:text-reasoning-ultra",
  },
};

/**
 * The shape of each level's sign on a 16 × 16 grid, drawn in `currentColor`
 * with a 2 px stroke and round ends: a ring, a dash, an arrow down, a filled
 * square, an arrow up, a double chevron up, a filled four-pointed spark and a
 * filled bolt.
 */
const SIGN_SHAPES: Readonly<Record<ReasoningBadgeLevel, React.ReactElement>> = {
  none: <circle cx="8" cy="8" r="5" />,
  minimal: <path d="M3.5 8h9" />,
  low: <path d="M8 3v10M3.5 8.5 8 13l4.5-4.5" />,
  medium: (
    <rect
      x="4"
      y="4"
      width="8"
      height="8"
      rx="1.8"
      fill="currentColor"
      stroke="none"
    />
  ),
  high: <path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" />,
  xhigh: <path d="M3.5 8 8 3.5 12.5 8M3.5 12.5 8 8l4.5 4.5" />,
  max: (
    <path
      d="M8 1.5c.6 3.7 2.8 5.9 6.5 6.5-3.7.6-5.9 2.8-6.5 6.5-.6-3.7-2.8-5.9-6.5-6.5 3.7-.6 5.9-2.8 6.5-6.5Z"
      fill="currentColor"
      stroke="none"
    />
  ),
  ultra: (
    <path
      d="M9.2 1.5 3.5 9h4.3l-1 5.5L12.5 7H8.2l1-5.5Z"
      fill="currentColor"
      strokeWidth={1}
    />
  ),
};

/**
 * The level whose colors and sign a reasoning value takes.
 * @param level - The level as the model names it, such as `high`.
 * @returns The known level, or `none` for a name the badge does not know.
 */
export function reasoningSignLevel(level: string): ReasoningBadgeLevel {
  return isReasoningBadgeLevel(level) ? level : "none";
}

/**
 * The sign of a reasoning level as a small SVG in `currentColor`.
 * @remarks
 * The sign always stands beside the level's word, so it is hidden from
 * assistive technology. Its size comes from `className`.
 */
export function ReasoningSign({
  level,
  className,
}: {
  readonly level: ReasoningBadgeLevel;
  readonly className?: string;
}): React.ReactElement {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      data-reasoning-sign={level}
      className={cn("shrink-0", className)}
    >
      {SIGN_SHAPES[level]}
    </svg>
  );
}

/**
 * The tile of a reasoning level with its sign centered on it.
 * @remarks
 * The size and radius of the tile come from `className`, the size of the
 * sign from `signClassName`: 18 px with a 12 px sign in the small badge,
 * 24 px with a 16 px sign in the open choice and 28 px with a 16 px sign in
 * the footer of an agent node.
 */
export function ReasoningTile({
  level,
  className,
  signClassName,
}: {
  readonly level: ReasoningBadgeLevel;
  readonly className: string;
  readonly signClassName: string;
}): React.ReactElement {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center",
        REASONING_LEVEL_CLASSES[level].tile,
        className,
      )}
    >
      <ReasoningSign level={level} className={signClassName} />
    </span>
  );
}
