import { useTranslation } from "react-i18next";

import type { AntigravityUsageTotal } from "@/definition/AgentSessionPricing";
import type { AgentSessionView } from "@/definition/AgentSessionJournal";

function UsageTotal(props: {
  readonly total: AntigravityUsageTotal;
  readonly label: string;
}): React.ReactElement {
  const { t, i18n } = useTranslation();
  const key = "plans.console.terminal.sidebar.antigravity";
  const unknown = t("plans.console.terminal.sidebar.unknown");
  const numbers = new Intl.NumberFormat(i18n.language);
  const currency = new Intl.NumberFormat(i18n.language, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 6,
  });
  const fields = [
    "inputTokens",
    "cacheReadTokens",
    "cacheWriteTokens",
    "outputTokens",
    "reasoningTokens",
  ] as const;
  const facts = fields.map((field) => ({
    label: t(`${key}.${field}`),
    value:
      props.total[field] === null
        ? unknown
        : numbers.format(props.total[field]),
  }));
  facts.push({
    label: t(`${key}.estimate`),
    value:
      props.total.amountUsd === null
        ? unknown
        : currency.format(props.total.amountUsd),
  });
  return (
    <div className="space-y-1.5">
      <h4 className="text-sm font-medium text-agent-console-foreground">
        {props.label}
      </h4>
      <dl className="space-y-1 text-sm">
        {facts.map((fact) => (
          <div key={fact.label} className="flex justify-between gap-3">
            <dt className="text-agent-console-muted">{fact.label}</dt>
            <dd className="text-agent-console-foreground">{fact.value}</dd>
          </div>
        ))}
      </dl>
      {props.total.isPartial && (
        <p className="text-xs text-agent-console-muted">
          {t(`${key}.partial`)}
        </p>
      )}
      {props.total.gaps.map((gap) => (
        <p key={gap} className="text-xs text-agent-console-muted">
          {t(`${key}.gap.${gap}`)}
        </p>
      ))}
      {props.total.priceAsOf.length > 0 && (
        <p className="text-xs text-agent-console-muted">
          {t(`${key}.priceAsOf`, { dates: props.total.priceAsOf.join(", ") })}
        </p>
      )}
    </div>
  );
}

/** Captured usage and reference value, separated from the subscription invoice. */
export function AntigravityUsageSection({
  view,
}: {
  readonly view: AgentSessionView;
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (!view.antigravity) return null;
  const key = "plans.console.terminal.sidebar.antigravity";
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold text-agent-console-foreground">
        {t(`${key}.title`)}
      </h3>
      <p className="text-xs text-agent-console-muted">
        {t(`${key}.subscription`)}
      </p>
      <UsageTotal total={view.antigravity.step} label={t(`${key}.step`)} />
      <UsageTotal total={view.antigravity.run} label={t(`${key}.run`)} />
    </section>
  );
}
