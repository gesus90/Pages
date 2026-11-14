import { useTranslation } from "react-i18next";

import type { ClaudeUsageSummary } from "@/definition/ClaudeUsage";

/** Claude token categories and subscription accounting, including explicit unknown measurements. */
export function ClaudeUsageDetails({
  usage,
}: {
  readonly usage: ClaudeUsageSummary;
}): React.ReactElement {
  const { t, i18n } = useTranslation();
  const numbers = new Intl.NumberFormat(i18n.language);
  const money = new Intl.NumberFormat(i18n.language, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  });
  const count = (amount: number | null): string =>
    amount === null
      ? t("plans.claudeUsage.unreported")
      : numbers.format(amount);
  const amount = usage.costUsd === null ? null : money.format(usage.costUsd);
  let cost = t("plans.claudeUsage.unreported");
  if (usage.hasUnknownPrice) cost = t("plans.claudeUsage.unknownPrice");
  else if (amount !== null)
    cost = usage.subscription ? t("plans.claudeUsage.subscription") : amount;
  return (
    <div className="space-y-1 text-xs text-muted-foreground">
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
        <dt>{t("plans.claudeUsage.input")}</dt>
        <dd>{count(usage.inputTokens)}</dd>
        <dt>{t("plans.claudeUsage.output")}</dt>
        <dd>{count(usage.outputTokens)}</dd>
        <dt>{t("plans.claudeUsage.cacheRead")}</dt>
        <dd>{count(usage.cacheReadTokens)}</dd>
        <dt>{t("plans.claudeUsage.cacheWrite")}</dt>
        <dd>{count(usage.cacheWriteTokens)}</dd>
        <dt>{t("plans.claudeUsage.cost")}</dt>
        <dd
          title={
            amount === null
              ? undefined
              : t("plans.claudeUsage.calculated", { amount })
          }
        >
          {cost}
        </dd>
      </dl>
      {amount !== null && usage.subscription ? (
        <p>{t("plans.claudeUsage.calculated", { amount })}</p>
      ) : null}
      {usage.isIncomplete ? <p>{t("plans.claudeUsage.incomplete")}</p> : null}
    </div>
  );
}
