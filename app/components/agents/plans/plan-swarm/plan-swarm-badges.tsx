import { Check, CircleSlash, LoaderCircle, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { planSwarmBadgeRows } from "./plan-swarm-model";

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
 * The helpers of a swarm as name badges H1 … H10, at most five per row.
 *
 * @remarks
 * Every badge is 24 px high in five equal columns with 4 px gaps. Its
 * status shows as the plan status color and a symbol, its tooltip names the
 * model and the current subtask.
 */
export function PlanSwarmBadges(props: {
  readonly badges: readonly PlanSwarmBadge[];
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <ul
      aria-label={t("plans.swarm.workers")}
      className="flex flex-col gap-1"
      data-plan-swarm-badges
    >
      {planSwarmBadgeRows(props.badges).map((row) => (
        <li key={row[0]?.id ?? "row"} className="grid grid-cols-5 gap-1">
          {row.map((badge) => (
            <span
              key={badge.id}
              data-plan-swarm-badge={badge.id}
              data-symbol={badge.symbol ?? "none"}
              title={[badge.model, badge.task].filter(Boolean).join(" · ")}
              className={cn(
                "flex h-6 min-w-0 items-center justify-center gap-0.5 rounded-md border text-[11px] leading-4 font-semibold tabular-nums",
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
            </span>
          ))}
        </li>
      ))}
    </ul>
  );
}
