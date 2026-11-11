import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import type {
  AgentActivityEntry,
  AgentCostState,
} from "@/definition/AgentEmployee";

/** Reads the kind-specific detail an entry carries as JSON. */
function readDetail(
  entry: AgentActivityEntry,
): Readonly<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(entry.detail);
    return typeof parsed === "object" && parsed !== null
      ? Object.fromEntries(Object.entries(parsed))
      : {};
  } catch (error: unknown) {
    if (error instanceof SyntaxError) return {};
    throw error;
  }
}

function text(value: unknown): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : "";
}

/** The month's known costs and the sessions without a reported cost. */
function CostSummary({
  cost,
}: {
  readonly cost: AgentCostState;
}): React.ReactElement {
  const { t, i18n } = useTranslation();
  const money = new Intl.NumberFormat(i18n.language, {
    style: "currency",
    currency: "USD",
  });
  return (
    <section className="flex flex-col gap-2 rounded-xl bg-muted px-4 py-3 text-sm">
      <p>
        {t("agentEmployees.activity.spent", {
          spent: money.format(cost.spent),
        })}
      </p>
      {cost.unknownSessions > 0 ? (
        <p className="text-muted-foreground">
          {t("agentEmployees.activity.unknownSessions", {
            count: cost.unknownSessions,
          })}
        </p>
      ) : null}
    </section>
  );
}

function costText(
  entry: AgentActivityEntry,
  money: Intl.NumberFormat,
  translate: (key: string) => string,
): string | null {
  if (entry.cost.state === "unknown")
    return translate("agentEmployees.activity.unknownCost");
  if (entry.cost.state !== "known" || entry.cost.amount === null) return null;
  const amount = money.format(entry.cost.amount);
  return entry.cost.isEstimated
    ? `${amount} ${translate("agentEmployees.activity.estimated")}`
    : amount;
}

function EntryLine({
  entry,
}: {
  readonly entry: AgentActivityEntry;
}): React.ReactElement {
  const { t, i18n } = useTranslation();
  const detail = readDetail(entry);
  const money = new Intl.NumberFormat(i18n.language, {
    style: "currency",
    currency: "USD",
  });
  const time = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(entry.at));
  const kind =
    entry.kind === "learning" && detail.isModelRun === true
      ? "learningSession"
      : entry.kind;
  const description = t(`agentEmployees.activity.kind.${kind}`, {
    state: t(`agentEmployees.activity.state.${text(detail.state) || "none"}`),
    person: text(detail.person),
    message: text(detail.message),
    from: t(`agentEmployees.access.${text(detail.from) || "read_only"}`),
    to: t(`agentEmployees.access.${text(detail.to) || "read_only"}`),
    status: t(
      `agentEmployees.memory.result.${text(detail.status) || "unchanged"}`,
      {
        added: detail.added ?? 0,
        merged: detail.merged ?? 0,
        archived: detail.archived ?? 0,
        removed: detail.removed ?? 0,
      },
    ),
  });
  const cost = costText(entry, money, t);
  return (
    <li className="flex items-start justify-between gap-3 px-3 py-2 text-sm">
      <span className="flex min-w-0 flex-col">
        <span className="text-xs text-muted-foreground">{time}</span>
        {entry.link ? (
          <Link className="text-primary-text hover:underline" to={entry.link}>
            {description}
          </Link>
        ) : (
          <span>{description}</span>
        )}
      </span>
      {cost ? (
        <span className="shrink-0 tabular-nums text-muted-foreground">
          {cost}
        </span>
      ) : null}
    </li>
  );
}

/**
 * The tab "Aktivität" (PAGE-266): what the agent did and when, with the
 * costs as far as its model reported them.
 */
export function AgentActivitySection({
  cost,
  entries,
}: {
  readonly cost: AgentCostState;
  readonly entries: readonly AgentActivityEntry[];
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-4">
      <CostSummary cost={cost} />
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("agentEmployees.activity.empty")}
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border/60 rounded-xl border border-border">
          {entries.map((entry) => (
            <EntryLine key={entry.id} entry={entry} />
          ))}
        </ul>
      )}
    </div>
  );
}
