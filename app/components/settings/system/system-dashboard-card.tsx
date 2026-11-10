import { Gauge } from "lucide-react";
import { useTranslation } from "react-i18next";

import { ServiceLightBadge } from "@/app/components/common/service-status-light";
import { SettingsCard } from "@/app/components/settings/settings-layout";

import { DiskPanel } from "./system-dashboard/disk-panel";
import { FactRow } from "./system-dashboard/fact-row";
import { LoadTiles } from "./system-dashboard/load-tiles";
import { ServicePanel } from "./system-dashboard/service-panel";
import { useSystemDashboard } from "./system-dashboard/use-system-dashboard";

import type { ServiceStatusReading } from "@/app/lib/service-status";
import type { ServiceStatusLight } from "@/definition/ServiceStatus";

/** The light of all services, as the former "Services" card showed it. */
function overallLight(
  reading: ServiceStatusReading | null,
): ServiceStatusLight {
  if (reading === null || reading.kind === "unreachable") return "unknown";
  return reading.kind === "granted" ? reading.details.light : reading.light;
}

function HeaderPills({
  reading,
}: {
  readonly reading: ServiceStatusReading | null;
}): React.ReactElement {
  const { t } = useTranslation();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="inline-flex items-center gap-2 rounded-full bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground">
        <span aria-hidden="true" className="size-2 rounded-full bg-success" />
        {t("settings.system.dashboard.live")}
      </span>
      <ServiceLightBadge light={overallLight(reading)} />
    </div>
  );
}

/**
 * The system dashboard over the full width of the system settings (PAGE-282).
 *
 * @remarks
 * Load tiles with their curves, the mounted drives, the services and a line
 * of facts. It reads every two seconds while the page is visible and shows
 * states only through values and colors: no banner, notice or event list.
 * The curves exist in this page only.
 */
export function SystemDashboardCard(): React.ReactElement {
  const { t } = useTranslation();
  const { dashboard, services, history, receivedAt, readAt } =
    useSystemDashboard();
  const now = readAt ?? 0;
  const lastBackup =
    services?.kind === "granted" ? (services.details.lastBackup ?? null) : null;

  return (
    <SettingsCard
      className="@container"
      icon={<Gauge className="size-4" aria-hidden="true" />}
      title={t("settings.system.dashboard.title")}
      description={t("settings.system.dashboard.description")}
      action={<HeaderPills reading={services} />}
      wrapHeader
    >
      <h4 className="mb-3 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
        {t("settings.system.dashboard.load")}
      </h4>
      <LoadTiles dashboard={dashboard} history={history} end={receivedAt} />
      <div className="mt-4 grid gap-4 min-[1100px]:grid-cols-[minmax(0,1fr)_minmax(0,1.45fr)]">
        <DiskPanel disks={dashboard?.disks ?? null} />
        <ServicePanel reading={services} now={now} />
      </div>
      <FactRow
        facts={dashboard?.facts ?? null}
        lastBackup={lastBackup}
        now={now}
      />
    </SettingsCard>
  );
}
