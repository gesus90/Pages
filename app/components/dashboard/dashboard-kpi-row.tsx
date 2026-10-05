import { useTranslation } from "react-i18next";

import {
  DashboardClockIcon,
  DashboardDocumentIcon,
  DashboardFolderIcon,
  DashboardRefreshIcon,
} from "@/app/components/dashboard/dashboard-icons";
import { DashboardKpiCard } from "@/app/components/dashboard/dashboard-kpi-card";

interface DashboardKpiRowProps {
  readonly openTickets: number;
  readonly openDelta: number;
  readonly overdueTickets: number;
  readonly overdueDelta: number;
  readonly inProgressTickets: number;
  readonly projectCount: number;
  readonly newProjects: number;
}

function formatDelta(value: number): string {
  if (value === 0) {
    return "±0";
  }

  return `+${value}`;
}

/** Renders the four KPI cards at the top of the dashboard. */
export function DashboardKpiRow({
  openTickets,
  openDelta,
  overdueTickets,
  overdueDelta,
  inProgressTickets,
  projectCount,
  newProjects,
}: DashboardKpiRowProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <div className="grid grid-cols-12 gap-5">
      <div className="col-span-12 sm:col-span-6 xl:col-span-3">
        <DashboardKpiCard
          label={t("dashboard.kpi.openTickets")}
          value={openTickets}
          deltaValue={formatDelta(openDelta)}
          deltaSuffix={t("dashboard.kpi.sinceLastWeek")}
          tone="accent"
          icon={<DashboardDocumentIcon />}
        />
      </div>
      <div className="col-span-12 sm:col-span-6 xl:col-span-3">
        <DashboardKpiCard
          label={t("dashboard.kpi.overdue")}
          value={overdueTickets}
          deltaValue={formatDelta(overdueDelta)}
          deltaSuffix={t("dashboard.kpi.sinceYesterday")}
          tone="accent"
          icon={<DashboardClockIcon />}
        />
      </div>
      <div className="col-span-12 sm:col-span-6 xl:col-span-3">
        <DashboardKpiCard
          label={t("dashboard.kpi.inProgress")}
          value={inProgressTickets}
          deltaValue={formatDelta(0)}
          deltaSuffix={t("dashboard.kpi.sinceLastWeek")}
          tone="muted"
          icon={<DashboardRefreshIcon />}
        />
      </div>
      <div className="col-span-12 sm:col-span-6 xl:col-span-3">
        <DashboardKpiCard
          label={t("dashboard.kpi.projects")}
          value={projectCount}
          deltaValue={formatDelta(newProjects)}
          deltaSuffix={t("dashboard.kpi.sinceLastMonth")}
          tone="positive"
          icon={<DashboardFolderIcon />}
        />
      </div>
    </div>
  );
}
