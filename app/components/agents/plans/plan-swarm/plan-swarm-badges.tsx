import { Check, CircleSlash, LoaderCircle, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import type { PlanSwarmBadge, PlanSwarmBadgeSymbol } from "./plan-swarm-model";

/** The symbol of a badge; colors alone never carry the status. */
export function PlanSwarmSymbol(props: {
  readonly symbol: PlanSwarmBadgeSymbol;
  readonly className?: string;
}): React.ReactElement | null {
  const className = cn("size-3 shrink-0", props.className);
  switch (props.symbol) {
    case "busy":
      return (
        <LoaderCircle
          aria-hidden="true"
          className={cn(className, "motion-safe:animate-spin")}
        />
      );
    case "done":
      return <Check aria-hidden="true" className={className} />;
    case "failed":
      return <X aria-hidden="true" className={className} />;
    case "notStarted":
      return <CircleSlash aria-hidden="true" className={className} />;
    case null:
      return null;
  }
}

/**
 * The helpers of a swarm as fields H1 … H10 beside the main model in the footer.
 * @remarks
 * Every field is 58 px wide and 40 px high with a 12 px corner and a 1.5 px
 * edge; the fields wrap into further rows. Its status shows as the plan
 * status color and a symbol, its tooltip names the model and the current
 * subtask.
 */
export function PlanSwarmBadges(props: {
  readonly badges: readonly PlanSwarmBadge[];
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <ul
      aria-label={t("plans.swarm.workers")}
      className="contents"
      data-plan-swarm-badges
    >
      {props.badges.map((badge) => (
        <li
          key={badge.id}
          data-plan-swarm-badge={badge.id}
          data-symbol={badge.symbol ?? "none"}
          title={[badge.model, badge.task].filter(Boolean).join(" · ")}
          className={cn(
            "flex h-10 w-[58px] shrink-0 items-center justify-center gap-1 rounded-xl border-[1.5px] text-xs leading-4 font-semibold tabular-nums",
            badge.className,
          )}
        >
          {badge.id}
          <PlanSwarmSymbol symbol={badge.symbol} />
          {badge.symbol ? (
            <span className="sr-only">
              {t(`plans.swarm.symbol.${badge.symbol}`)}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
