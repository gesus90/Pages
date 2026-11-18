import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";
import { claudePlanTier } from "@/definition/ClaudeQuota";

import type { ClaudePlan } from "@/definition/ClaudeQuota";

/** Heights of the four tier bars in px, from Free to Ultra. */
const TIER_BAR_HEIGHTS = [5, 8, 11, 14] as const;

/**
 * The tier mark of the badge: four rising bars, as many filled as the tier.
 * @remarks
 * Bars above the tier stay at 30 % opacity, so an unknown plan shows four
 * faint bars and no filled one.
 */
function PlanTierMark({ tier }: { readonly tier: number }): React.ReactElement {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 14 14"
      className="size-3.5"
      fill="currentColor"
    >
      {TIER_BAR_HEIGHTS.map((height, index) => (
        <rect
          key={height}
          data-plan-bar={index < tier ? "filled" : "empty"}
          x={index * 3.67}
          y={14 - height}
          width={3}
          height={height}
          rx={0.75}
          opacity={index < tier ? 1 : 0.3}
        />
      ))}
    </svg>
  );
}

/**
 * The subscription of a Claude card: a tier mark and the plan's name.
 * @remarks
 * 24 px high with a 1 px border and a 7 px radius, like the model badge: the
 * 18 px tile with a 5 px radius sits 2 px from the top, bottom and left edge.
 * Free, Pro, Max and Ultra fill one to four bars in Claude's orange and are
 * all 68 px wide, so the cards line up. A plan Claude did not name for
 * certain reads "Tarif unbekannt" in muted colors with a neutral border, as
 * wide as its text.
 */
export function ClaudePlanBadge({
  plan,
}: {
  readonly plan: ClaudePlan | null;
}): React.ReactElement {
  const { t } = useTranslation();
  const isKnown = plan !== null;
  return (
    <span
      data-claude-plan={plan ?? "unknown"}
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-[7px] border bg-surface py-[2px] pr-2 pl-[2px] text-[11px] leading-none font-semibold",
        isKnown
          ? "w-[68px] border-claude text-foreground"
          : "border-border text-muted-foreground",
      )}
    >
      <span
        className={cn(
          "inline-flex size-[18px] shrink-0 items-center justify-center rounded-[5px]",
          isKnown ? "bg-claude/15 text-claude" : "bg-muted",
        )}
      >
        <PlanTierMark tier={claudePlanTier(plan)} />
      </span>
      <span className="whitespace-nowrap">
        {t(`agentsPage.plan.${plan ?? "unknown"}`)}
      </span>
    </span>
  );
}
