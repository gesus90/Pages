import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";
import { isReasoningBadgeLevel } from "@/definition/AgentModelIdentity";

import type {
  AgentValueStatus,
  ReasoningBadgeLevel,
} from "@/definition/AgentModelIdentity";

/** Border, text, background and dot of each level; static, so Tailwind finds the classes. */
const LEVEL_CLASSES: Readonly<
  Record<ReasoningBadgeLevel, { readonly badge: string; readonly dot: string }>
> = {
  none: {
    badge:
      "border-reasoning-none-dot bg-reasoning-none-subtle text-reasoning-none",
    dot: "bg-reasoning-none-dot",
  },
  minimal: {
    badge:
      "border-reasoning-minimal-dot bg-reasoning-minimal-subtle text-reasoning-minimal",
    dot: "bg-reasoning-minimal-dot",
  },
  low: {
    badge:
      "border-reasoning-low-dot bg-reasoning-low-subtle text-reasoning-low",
    dot: "bg-reasoning-low-dot",
  },
  medium: {
    badge:
      "border-reasoning-medium-dot bg-reasoning-medium-subtle text-reasoning-medium",
    dot: "bg-reasoning-medium-dot",
  },
  high: {
    badge:
      "border-reasoning-high-dot bg-reasoning-high-subtle text-reasoning-high",
    dot: "bg-reasoning-high-dot",
  },
  xhigh: {
    badge:
      "border-reasoning-xhigh-dot bg-reasoning-xhigh-subtle text-reasoning-xhigh",
    dot: "bg-reasoning-xhigh-dot",
  },
  max: {
    badge:
      "border-reasoning-max-dot bg-reasoning-max-subtle text-reasoning-max",
    dot: "bg-reasoning-max-dot",
  },
  ultra: {
    badge:
      "border-reasoning-ultra-dot bg-reasoning-ultra-subtle text-reasoning-ultra",
    dot: "bg-reasoning-ultra-dot",
  },
};

interface ReasoningBadgeProps {
  /** The reasoning level as the model names it, such as `high`. */
  readonly level: string;
  readonly status?: AgentValueStatus;
  /** Whether the model offers the level; `false` adds a warning, `null` says nothing. */
  readonly isOffered?: boolean | null;
  readonly className?: string;
}

/**
 * The reasoning level as a badge of its own: a dot and the word in the
 * level's color.
 * @remarks
 * The word always stands beside the color, so the color alone carries no
 * meaning. A level the badge does not know keeps its raw name in the grey
 * style of `none`. Showing a level never widens what a model offers: a level
 * the model does not offer is marked as such. The 1 px solid border takes the
 * dot's color of the level in either theme. Whether the adapter confirmed the
 * level stands in the tooltip and the accessible name, never in the border.
 */
export function ReasoningBadge({
  level,
  status = "configured",
  isOffered = null,
  className,
}: ReasoningBadgeProps): React.ReactElement {
  const { t } = useTranslation();
  const isKnown = isReasoningBadgeLevel(level);
  const classes = LEVEL_CLASSES[isKnown ? level : "none"];
  const word = isKnown ? t(`agentBadges.reasoning.level.${level}`) : level;
  const notes = [
    t(`agentBadges.model.status.${status}`),
    ...(isOffered === false ? [t("agentBadges.reasoning.notOffered")] : []),
  ].join(" · ");
  return (
    <span
      title={`${word} · ${notes}`}
      aria-label={t("agentBadges.reasoning.label", { level: word, notes })}
      data-reasoning-badge={isKnown ? level : "unknown"}
      data-value-status={status}
      className={cn(
        "inline-flex h-6 max-w-full min-w-0 shrink-0 items-center gap-1.5 rounded-[7px] border px-2 text-[11px] leading-none font-semibold",
        classes.badge,
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn("size-1.5 shrink-0 rounded-full", classes.dot)}
      />
      <span className="min-w-0 truncate">{word}</span>
      {isOffered === false ? (
        <span aria-hidden="true" className="shrink-0">
          ⚠
        </span>
      ) : null}
    </span>
  );
}
