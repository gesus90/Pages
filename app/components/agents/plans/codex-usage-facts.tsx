import { useTranslation } from "react-i18next";

import type { CodexUsageSummary } from "@/definition/CodexPlanUsage";

function costStatusLabel(
  hasTokens: boolean,
  isPriceUnknown: boolean,
  t: (key: string) => string,
): string {
  if (!hasTokens) return t("codexUsage.notReported");
  return isPriceUnknown
    ? t("codexUsage.priceUnknown")
    : t("codexUsage.subscription");
}

/** Token subsets and calculated subscription equivalent, shared by the panel and console. */
export function CodexUsageFacts({
  usage,
}: {
  readonly usage: CodexUsageSummary;
}): React.ReactElement {
  const { t, i18n } = useTranslation();
  const numbers = new Intl.NumberFormat(i18n.language);
  const unknown = t("codexUsage.notReported");
  const equivalent =
    usage.costUsd === null
      ? t("codexUsage.priceUnknown")
      : new Intl.NumberFormat(i18n.language, {
          style: "currency",
          currency: "USD",
          minimumFractionDigits: 2,
          maximumFractionDigits: 6,
        }).format(usage.costUsd);
  const fields = [
    "inputTokens",
    "cacheReadTokens",
    "outputTokens",
    "reasoningTokens",
  ] as const;
  const hasTokens = usage.inputTokens !== null || usage.outputTokens !== null;
  const cost = costStatusLabel(hasTokens, usage.isPriceUnknown, t);
  return (
    <div className="space-y-1 text-xs">
      <dl className="flex flex-wrap gap-x-4 gap-y-1">
        {fields.map((field) => (
          <div key={field}>
            <dt className="inline text-muted-foreground">
              {t(`codexUsage.${field}`)}:{" "}
            </dt>
            <dd className="inline">
              {usage[field] === null ? unknown : numbers.format(usage[field])}
            </dd>
          </div>
        ))}
        <div>
          <dt className="inline text-muted-foreground">
            {t("codexUsage.cost")}:{" "}
          </dt>
          <dd
            className="inline"
            title={t("codexUsage.equivalent", { amount: equivalent })}
          >
            {cost}
            {usage.costUsd === null ? null : ` (≈ ${equivalent})`}
          </dd>
        </div>
      </dl>
      {usage.isPartial ? (
        <p className="text-muted-foreground">{t("codexUsage.incomplete")}</p>
      ) : null}
    </div>
  );
}
