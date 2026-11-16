import { probabilityPercent } from "@/definition/ConversationDecision";

import type { TFunction } from "i18next";
import type { AgentPlanDecisionVerdict } from "@/definition/AgentPlanDecision";

/**
 * What a run shows beside the answer of a model decision.
 * @param t - The translation of the page.
 * @param verdict - The answer of the decision.
 * @returns The reason of an answer that has one; for a decision model, which
 * gives no reason, its probability, confidence and cost; `null` when there
 * is nothing to show, so no placeholder stands in for a missing reason.
 */
export function planVerdictDetail(
  t: TFunction,
  verdict: AgentPlanDecisionVerdict,
): string | null {
  if (verdict.reason.trim() !== "")
    return t("plans.decision.reason", { reason: verdict.reason });
  const details = [
    verdict.probability === undefined
      ? null
      : t("plans.decision.probability", {
          percent: probabilityPercent(verdict.probability),
        }),
    verdict.confidence === undefined
      ? null
      : t("plans.decision.confidence", {
          percent: probabilityPercent(verdict.confidence),
        }),
    verdict.costUsd === undefined
      ? null
      : t("plans.decision.cost", { cost: verdict.costUsd.toFixed(6) }),
  ].filter((detail) => detail !== null);
  return details.length === 0 ? null : details.join(" · ");
}
