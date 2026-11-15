import { useTranslation } from "react-i18next";

import { ClaudeUsageDetails } from "./claude-usage-details";

import type { ClaudeRunUsage } from "@/definition/ClaudeUsage";

/** The sum of every Claude step, with a separate reading for each loop iteration and retry. */
export function PlanClaudeUsage({
  usage,
}: {
  readonly usage: ClaudeRunUsage | null | undefined;
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (!usage) return null;
  return (
    <section className="space-y-3" aria-label={t("plans.claudeUsage.title")}>
      <h3 className="text-sm font-medium">{t("plans.claudeUsage.title")}</h3>
      <ClaudeUsageDetails usage={usage.total} />
      {usage.steps.map((step, index) => (
        <details
          key={step.attemptId}
          className="rounded border border-border p-2"
        >
          <summary className="cursor-pointer text-xs">
            {index + 1}. {step.name}
          </summary>
          <div className="pt-2">
            <ClaudeUsageDetails usage={step.usage} />
          </div>
        </details>
      ))}
    </section>
  );
}
