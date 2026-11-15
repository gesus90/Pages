import { useTranslation } from "react-i18next";

import type { OpenCodeUsageTotal } from "@/definition/AgentSessionJournal";

interface UsageSectionProps {
  readonly step: OpenCodeUsageTotal;
  readonly run: OpenCodeUsageTotal;
}

function UsageFact(props: {
  readonly label: string;
  readonly text: string;
}): React.ReactElement {
  return (
    <div className="flex justify-between gap-3 text-sm">
      <dt className="text-agent-console-muted">{props.label}</dt>
      <dd className="text-right text-agent-console-foreground">{props.text}</dd>
    </div>
  );
}

function formatUsageCost(
  total: OpenCodeUsageTotal,
  freeLabel: string,
  priceUnknownLabel: string,
  dollars: Intl.NumberFormat,
): string {
  if (total.costState === "free") return `${freeLabel} · ${dollars.format(0)}`;
  if (total.costUsd === null) return priceUnknownLabel;
  return dollars.format(total.costUsd);
}

function UsageGroup(props: {
  readonly title: string;
  readonly total: OpenCodeUsageTotal;
}): React.ReactElement {
  const { t, i18n } = useTranslation();
  const key = "plans.console.terminal.sidebar";
  const numbers = new Intl.NumberFormat(i18n.language);
  const missing = t(`${key}.notReported`);
  const count = (value: number | null): string =>
    value === null ? missing : numbers.format(value);
  const dollars = new Intl.NumberFormat(i18n.language, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 6,
  });
  const cost = formatUsageCost(
    props.total,
    t(`${key}.free`),
    t(`${key}.priceUnknown`),
    dollars,
  );
  return (
    <div className="space-y-1.5">
      <h4 className="text-sm font-semibold text-agent-console-foreground">
        {props.title}
        {props.total.isIncomplete ? ` · ${t(`${key}.incomplete`)}` : ""}
      </h4>
      <dl className="space-y-1">
        <UsageFact
          label={t(`${key}.inputTokens`)}
          text={count(props.total.inputTokens)}
        />
        <UsageFact
          label={t(`${key}.outputTokens`)}
          text={count(props.total.outputTokens)}
        />
        <UsageFact
          label={t(`${key}.reasoningTokens`)}
          text={count(props.total.reasoningTokens)}
        />
        <UsageFact
          label={t(`${key}.cacheReadTokens`)}
          text={count(props.total.cacheReadTokens)}
        />
        <UsageFact
          label={t(`${key}.cacheWriteTokens`)}
          text={count(props.total.cacheWriteTokens)}
        />
        <UsageFact label={t(`${key}.cost`)} text={cost} />
      </dl>
      {props.total.priceAsOf.length > 0 ? (
        <p className="text-xs text-agent-console-muted">
          {t(`${key}.priceAsOf`, { date: props.total.priceAsOf.join(", ") })}
        </p>
      ) : null}
    </div>
  );
}

/** Native OpenCode message usage of the current node and the complete run. */
export function OpenCodeUsageSection(
  props: UsageSectionProps,
): React.ReactElement {
  const { t } = useTranslation();
  const key = "plans.console.terminal.sidebar";
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold text-agent-console-foreground">
        {t(`${key}.usage`)}
      </h3>
      <UsageGroup title={t(`${key}.stepTotal`)} total={props.step} />
      <UsageGroup title={t(`${key}.runTotal`)} total={props.run} />
    </section>
  );
}
