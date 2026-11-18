import { useTranslation } from "react-i18next";

import type { ClaudePlan } from "@/definition/ClaudeQuota";

/**
 * The subscription of a Claude card, outlined in Claude's orange.
 * @remarks
 * 24 px high with a 1 px border and a 7 px radius, like the model badge. A
 * plan that is not known for certain reads "Tarif unbekannt".
 */
export function ClaudePlanBadge({
  plan,
}: {
  readonly plan: ClaudePlan | null;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <span
      data-claude-plan={plan ?? "unknown"}
      className="inline-flex h-6 shrink-0 items-center rounded-[7px] border border-claude bg-surface px-2 text-[11px] leading-none font-semibold text-foreground"
    >
      {t(`agentsPage.plan.${plan ?? "unknown"}`)}
    </span>
  );
}
