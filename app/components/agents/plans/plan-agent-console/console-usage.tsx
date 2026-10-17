import { useState } from "react";
import { useTranslation } from "react-i18next";

import { SegmentedControl } from "@/app/components/ui/segmented-control";

import type {
  AgentSessionContextUsage,
  AgentSessionTokenUsage,
  AgentSessionView,
} from "@/definition/AgentSessionJournal";

type UsageScope = "turn" | "attempt" | "run";

const NUMBER = new Intl.NumberFormat(undefined, { notation: "compact" });

function count(value: number | null): string {
  return value === null ? "–" : NUMBER.format(value);
}

/** A share only for a known, valid occupancy and limit; nothing is estimated. */
function contextShare(context: AgentSessionContextUsage): number | null {
  const { contextUsed, contextLimit } = context;
  if (contextUsed === null || contextLimit === null) return null;
  if (contextLimit <= 0 || contextUsed < 0) return null;
  return Math.min(100, (contextUsed / contextLimit) * 100);
}

function ContextMeter({
  context,
}: {
  readonly context: AgentSessionContextUsage;
}): React.ReactElement {
  const { t } = useTranslation();
  const share = contextShare(context);
  if (share === null)
    return (
      <p className="text-xs text-muted-foreground">
        {t("plans.console.contextUnavailable")}
      </p>
    );
  return (
    <div className="space-y-1">
      <div
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(share)}
        aria-label={t("plans.console.context")}
        className="h-2 overflow-hidden rounded-full bg-muted"
      >
        <div className="h-full bg-info" style={{ width: `${share}%` }} />
      </div>
      <p className="text-xs text-muted-foreground">
        {t("plans.console.contextValue", {
          used: count(context.contextUsed),
          limit: count(context.contextLimit),
          percent: Math.round(share),
        })}
      </p>
    </div>
  );
}

function TokenRow({
  usage,
  label,
}: {
  readonly usage: AgentSessionTokenUsage;
  readonly label: string | null;
}): React.ReactElement {
  const { t } = useTranslation();
  const cacheHint =
    usage.inputIncludesCache === null
      ? t("plans.console.cacheUnverified")
      : t(
          usage.inputIncludesCache
            ? "plans.console.cacheIncluded"
            : "plans.console.cacheApart",
        );
  const cells: readonly [string, number | null, string | undefined][] = [
    ["in", usage.inputTokens, cacheHint],
    ["out", usage.outputTokens, undefined],
    ["cacheRead", usage.cacheReadTokens, t("plans.console.cacheReadHint")],
    ["cacheWrite", usage.cacheWriteTokens, t("plans.console.cacheWriteHint")],
  ];
  return (
    <div className="space-y-1">
      {label ? <p className="text-xs text-muted-foreground">{label}</p> : null}
      <dl className="grid grid-cols-4 gap-2 text-xs">
        {cells.map(([name, value, hint]) => (
          <div key={name} className="rounded-md bg-muted px-2 py-1">
            <dt
              title={hint}
              className={
                hint ? "cursor-help underline decoration-dotted" : undefined
              }
            >
              {t(`plans.console.tokens.${name}`)}
            </dt>
            <dd className="font-mono">{count(value)}</dd>
          </div>
        ))}
      </dl>
      {usage.isPartial ? (
        <p className="text-xs text-muted-foreground">
          {t("plans.console.partial")}
        </p>
      ) : null}
    </div>
  );
}

function scopedUsage(
  view: AgentSessionView,
  scope: UsageScope,
): readonly {
  readonly key: string;
  readonly usage: AgentSessionTokenUsage;
  readonly label: string | null;
}[] {
  if (scope === "turn") {
    const last = view.turns.at(-1);
    return last
      ? [{ key: `turn-${last.turn}`, usage: last, label: last.model }]
      : [];
  }
  const totals = scope === "attempt" ? view.totals : view.runTotals;
  return totals.map((total) => ({
    key: total.provider,
    usage: total,
    label: total.models.join(", ") || null,
  }));
}

/**
 * Context occupancy and token counts, kept apart and taken from the backend only.
 *
 * @remarks
 * Cumulative cache reads may exceed the context window: every turn reads the
 * cached prefix again, while the context shows what is in the window now.
 */
export function ConsoleUsage({
  view,
}: {
  readonly view: AgentSessionView;
}): React.ReactElement {
  const { t } = useTranslation();
  const [scope, setScope] = useState<UsageScope>("attempt");
  const entries = scopedUsage(view, scope);
  return (
    <section aria-labelledby="console-usage" className="space-y-3">
      <h3 id="console-usage" className="text-sm font-semibold">
        {t("plans.console.usage")}
      </h3>
      <ContextMeter context={view.context} />
      <SegmentedControl
        ariaLabel={t("plans.console.usageScope")}
        value={scope}
        onValueChange={setScope}
        options={(["turn", "attempt", "run"] as const).map((value) => ({
          value,
          label: t(`plans.console.scope.${value}`),
        }))}
      />
      {entries.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {t("plans.console.noTokens")}
        </p>
      ) : (
        entries.map((entry) => (
          <TokenRow key={entry.key} usage={entry.usage} label={entry.label} />
        ))
      )}
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer">
          {t("plans.console.cacheExplained")}
        </summary>
        <p className="mt-1">{t("plans.console.cacheReadHint")}</p>
        <p className="mt-1">{t("plans.console.cacheWriteHint")}</p>
      </details>
    </section>
  );
}
