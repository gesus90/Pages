import { useTranslation } from "react-i18next";

import { MISSING_VALUE, useDashboardFormat } from "./use-dashboard-format";

import type { TFunction } from "i18next";
import type { DashboardFacts } from "@/definition/SystemDashboard";
import type { DashboardFormat } from "./use-dashboard-format";

/** The facts in their order. */
const FACT_KEYS = [
  "version",
  "node",
  "pagesUptime",
  "serverUptime",
  "database",
  "dataDirectory",
  "lastBackup",
  "tools",
] as const;

/** The facts of the measurement; the last backup comes from the service status. */
type MeasuredFactKey = Exclude<(typeof FACT_KEYS)[number], "lastBackup">;

type MeasuredFacts = Readonly<Record<MeasuredFactKey, string>>;

const NO_FACTS: MeasuredFacts = {
  version: MISSING_VALUE,
  node: MISSING_VALUE,
  pagesUptime: MISSING_VALUE,
  serverUptime: MISSING_VALUE,
  database: MISSING_VALUE,
  dataDirectory: MISSING_VALUE,
  tools: MISSING_VALUE,
};

function readMeasuredFacts(
  facts: DashboardFacts,
  context: {
    readonly format: DashboardFormat;
    readonly t: TFunction;
    readonly now: number;
  },
): MeasuredFacts {
  const { format, t, now } = context;
  const { databaseSize, tools } = facts;
  return {
    version: facts.version,
    node: facts.nodeVersion,
    pagesUptime: format.duration(facts.pagesStartedAt, now),
    serverUptime: format.duration(facts.serverStartedAt, now),
    database:
      databaseSize === null
        ? MISSING_VALUE
        : t("settings.system.dashboard.facts.databaseValue", {
            size: format.bytes(databaseSize),
          }),
    dataDirectory: format.bytes(facts.dataDirectorySize),
    tools:
      tools === null
        ? MISSING_VALUE
        : t("settings.system.dashboard.facts.toolsValue", { ...tools }),
  };
}

interface FactRowProps {
  /** `null` before the first measurement. */
  readonly facts: DashboardFacts | null;
  /** When the base backup last succeeded, from the service status. */
  readonly lastBackup: number | null;
  /** When the last answer arrived; running times count to it. */
  readonly now: number;
}

/**
 * The eight facts below the panels: a small muted label above each value.
 *
 * @remarks
 * The values carry the weight of the values in the panels above, medium and
 * not bold, and no line separates the row from the panels. A value without
 * a source is `—`.
 */
export function FactRow({
  facts,
  lastBackup,
  now,
}: FactRowProps): React.ReactElement {
  const { t } = useTranslation();
  const format = useDashboardFormat();
  const measured = facts
    ? readMeasuredFacts(facts, { format, t, now })
    : NO_FACTS;
  const backup = format.day(lastBackup, now);

  return (
    <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 @min-[34rem]:grid-cols-4 @min-[60rem]:grid-cols-[repeat(8,auto)] @min-[60rem]:justify-between">
      {FACT_KEYS.map((key) => (
        <div key={key} className="min-w-0" data-fact={key}>
          <dt className="truncate text-xs text-muted-foreground">
            {t(`settings.system.dashboard.facts.${key}`)}
          </dt>
          <dd className="mt-0.5 text-sm font-medium break-words text-foreground tabular-nums">
            {key === "lastBackup" ? backup : measured[key]}
          </dd>
        </div>
      ))}
    </dl>
  );
}
