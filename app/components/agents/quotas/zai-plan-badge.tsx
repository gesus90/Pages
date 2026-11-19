import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import type { ZaiPlan } from "@/definition/ZaiQuota";

/**
 * The GLM Coding Plan tier of a Z.AI card.
 * @remarks
 * 24 px high with a 1 px border and a 7 px radius, like the plan badges of
 * the other cards. A tier Z.AI did not name reads "Tarif unbekannt" in muted
 * colors; the card shows no badge for a standard API key, which has no tier.
 */
export function ZaiPlanBadge({
  plan,
}: {
  readonly plan: ZaiPlan | null;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <span
      data-zai-plan={plan ?? "unknown"}
      className={cn(
        "inline-flex h-6 shrink-0 items-center rounded-[7px] border bg-surface px-2 text-[11px] leading-none font-semibold whitespace-nowrap",
        plan === null
          ? "border-border text-muted-foreground"
          : "border-border-strong text-foreground",
      )}
    >
      {plan === null
        ? t("agentsPage.plan.unknown")
        : t(`agentsPage.zai.plan.${plan}`)}
    </span>
  );
}
