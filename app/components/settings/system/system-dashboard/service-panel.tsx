import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { DashboardPanel, UsageBar } from "./dashboard-panel";
import { MISSING_VALUE, useDashboardFormat } from "./use-dashboard-format";

import type { ServiceStatusReading } from "@/app/lib/service-status";
import type {
  ServiceState,
  ServiceStatusLight,
} from "@/definition/ServiceStatus";

/** The services of the platform by unit name, without instance and suffix. */
const SERVICE_NAME_KEYS: Readonly<Record<string, string>> = {
  "pages-api": "api",
  "pages-runs": "runs",
  "pages-core": "core",
  "pages-core-config": "coreConfig",
  "pages-ingress": "ingress",
  "pages-integrations": "integrations",
  "pages-postgres": "postgres",
};

/** The dot of each light, as the badge of the service status shows it. */
const DOT_STYLES: Readonly<Record<ServiceStatusLight, string>> = {
  green: "bg-success",
  yellow: "bg-warning",
  red: "bg-destructive",
  unknown: "bg-muted-foreground",
};

const STATE_LIGHTS: Readonly<
  Record<ServiceState["state"], ServiceStatusLight>
> = {
  active: "green",
  activating: "yellow",
  deactivating: "yellow",
  reloading: "yellow",
  refreshing: "yellow",
  inactive: "red",
  failed: "red",
  maintenance: "red",
  unknown: "unknown",
};

/** States in which the main process runs, so its start tells how long. */
const RUNNING_STATES: ReadonlySet<ServiceState["state"]> = new Set([
  "active",
  "reloading",
  "refreshing",
]);

/** The light of one service; an older core sends none, then its state decides. */
function serviceLight(service: ServiceState): ServiceStatusLight {
  return service.light ?? STATE_LIGHTS[service.state];
}

function MemoryCell({
  service,
}: {
  readonly service: ServiceState;
}): React.ReactElement {
  const { t } = useTranslation();
  const format = useDashboardFormat();
  const current = service.memoryCurrent ?? null;
  const limit = service.memoryLimit ?? null;
  const ratio =
    current === null || limit === null || limit === 0
      ? null
      : Math.min(1, current / limit);
  let text = MISSING_VALUE;
  if (current !== null)
    text =
      limit === null
        ? t("settings.system.dashboard.services.noLimit", {
            current: format.bytes(current),
          })
        : t("settings.system.dashboard.services.memory", {
            current: format.bytes(current),
            limit: format.bytes(limit),
          });

  return (
    <div className="flex items-center gap-3">
      <UsageBar ratio={ratio} className="h-1.5 w-28 shrink-0" />
      <span className="ml-auto text-xs whitespace-nowrap text-muted-foreground tabular-nums">
        {text}
      </span>
    </div>
  );
}

function ServiceRow({
  service,
  now,
}: {
  readonly service: ServiceState;
  readonly now: number;
}): React.ReactElement {
  const { t } = useTranslation();
  const format = useDashboardFormat();
  const nameKey = SERVICE_NAME_KEYS[service.name.split(/[@.]/u)[0] ?? ""];
  const isRunning = RUNNING_STATES.has(service.state);

  return (
    <tr
      className="border-t border-border/70"
      data-service-state={service.state}
    >
      <th scope="row" className="py-2 pr-3 text-left font-medium">
        <span className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden="true"
            className={cn(
              "size-2 shrink-0 rounded-full",
              DOT_STYLES[serviceLight(service)],
            )}
          />
          <span className="truncate" title={service.name}>
            {nameKey === undefined
              ? service.name.replace(/\.service$/u, "")
              : t(`settings.system.dashboard.services.names.${nameKey}`)}
          </span>
          <span className="sr-only">
            {t(`serviceStatus.state.${service.state}`)}
          </span>
        </span>
      </th>
      <td className="py-2 pr-3">
        <MemoryCell service={service} />
      </td>
      <td className="py-2 pr-3 whitespace-nowrap tabular-nums">
        {isRunning ? format.duration(service.lastStart, now) : MISSING_VALUE}
      </td>
      <td className="py-2 tabular-nums">{service.restarts}</td>
    </tr>
  );
}

function ServiceTable({
  services,
  now,
}: {
  readonly services: readonly ServiceState[];
  readonly now: number;
}): React.ReactElement {
  const { t } = useTranslation();
  const columns = ["name", "memory", "uptime", "restarts"] as const;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[34rem] text-sm">
        <thead className="text-xs text-muted-foreground">
          <tr>
            {columns.map((column) => (
              <th
                key={column}
                scope="col"
                className="pr-3 pb-2 text-left font-normal last:pr-0"
              >
                {t(`settings.system.dashboard.services.column.${column}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {services.map((service) => (
            <ServiceRow key={service.name} service={service} now={now} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The services of the platform with state, memory against the limit, running time and restarts.
 *
 * @remarks
 * Read from `pages-core`, the source of the service status; without its
 * details only a quiet line stands in place of the table.
 */
export function ServicePanel({
  reading,
  now,
}: {
  readonly reading: ServiceStatusReading | null;
  /** When the last answer arrived; the running times count to it. */
  readonly now: number;
}): React.ReactElement {
  const { t } = useTranslation();
  const services =
    reading?.kind === "granted" ? reading.details.services : null;
  const running = services?.filter(
    (service) => serviceLight(service) === "green",
  ).length;

  return (
    <DashboardPanel
      title={t("settings.system.dashboard.services.title")}
      meta={
        services === null
          ? MISSING_VALUE
          : t("settings.system.dashboard.services.running", {
              running,
              total: services.length,
            })
      }
    >
      {services === null ? (
        <p className="text-sm text-muted-foreground">
          {t(`serviceStatus.${reading?.kind ?? "loading"}`)}
        </p>
      ) : (
        <ServiceTable services={services} now={now} />
      )}
    </DashboardPanel>
  );
}
