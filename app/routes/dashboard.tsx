import { useTranslation } from "react-i18next";
import { useLoaderData } from "react-router";

import { DashboardHeader } from "@/app/components/dashboard/dashboard-header";
import { DashboardKpiRow } from "@/app/components/dashboard/dashboard-kpi-row";
import { DashboardMyTasks } from "@/app/components/dashboard/dashboard-my-tasks";
import { DashboardPanel } from "@/app/components/dashboard/dashboard-panel";
import { DashboardProjectOverview } from "@/app/components/dashboard/dashboard-project-overview";
import { DashboardRecentlyEdited } from "@/app/components/dashboard/dashboard-recently-edited";
import { DashboardScrollArea } from "@/app/components/dashboard/dashboard-scroll-area";
import { DashboardUpcomingDeadlines } from "@/app/components/dashboard/dashboard-upcoming-deadlines";
import { useLocalStateRoute } from "@/app/components/common/use-local-state-route";
import {
  isCurrentLocalStateAudience,
  isLocalStateAudience,
} from "@/app/lib/local-state/local-state-audience";
import {
  loadLocalFirst,
  localStateRoute,
} from "@/app/lib/local-state/local-state-loader";
import { readRouteData } from "@/app/lib/local-state/route-data";

import type { DashboardDeadline } from "@/app/components/dashboard/dashboard-upcoming-deadlines";
import type { DashboardMyTask } from "@/app/components/dashboard/dashboard-my-tasks";
import type { DashboardProjectEntry } from "@/app/components/dashboard/dashboard-project-overview";
import type { DashboardRecentItem } from "@/app/components/dashboard/dashboard-recently-edited";
import type { LocalStateRouteKind } from "@/app/components/common/use-local-state-route";
import type { LocalStateAudience } from "@/app/lib/local-state/local-state-audience";
import type { WithLocalState } from "@/app/lib/local-state/local-state-loader";
import type { Route } from "./+types/dashboard";

/** Dashboard numbers shown in the top KPI row. */
export interface DashboardLoaderData {
  readonly displayName: string;
  readonly hour: number;
  readonly openTickets: number;
  readonly openDelta: number;
  readonly overdueTickets: number;
  readonly overdueDelta: number;
  readonly inProgressTickets: number;
  readonly projectCount: number;
  readonly newProjects: number;
  readonly myTasks: readonly DashboardMyTask[];
  readonly projectOverview: readonly DashboardProjectEntry[];
  readonly recentlyEdited: readonly DashboardRecentItem[];
  readonly upcomingDeadlines: readonly DashboardDeadline[];
  readonly audience: LocalStateAudience;
}

/** Whether a value has the shape of {@link DashboardLoaderData}. */
function isDashboardLoaderData(value: unknown): value is DashboardLoaderData {
  return (
    typeof value === "object" &&
    value !== null &&
    "displayName" in value &&
    typeof value.displayName === "string" &&
    "myTasks" in value &&
    Array.isArray(value.myTasks) &&
    "projectOverview" in value &&
    Array.isArray(value.projectOverview) &&
    "recentlyEdited" in value &&
    Array.isArray(value.recentlyEdited) &&
    "upcomingDeadlines" in value &&
    Array.isArray(value.upcomingDeadlines) &&
    "audience" in value &&
    isLocalStateAudience(value.audience)
  );
}

/** The dashboard, kept per account and rights. */
const DASHBOARD_STATE: LocalStateRouteKind<DashboardLoaderData> = {
  schemaVersion: 1,
  isPayload: isDashboardLoaderData,
  isCurrent: (page) => isCurrentLocalStateAudience(page.audience),
  ownerOf: (page) => page.audience.userId,
  isRefused: () => false,
};

/**
 * Opens the dashboard from the account's kept answer at once and asks the endpoint behind it.
 *
 * @remarks
 * The endpoint runs the server loader with its permission checks (PAGE-235).
 */
export async function clientLoader({
  request,
}: Route.ClientLoaderArgs): Promise<WithLocalState<DashboardLoaderData>> {
  const url = new URL(request.url);
  return loadLocalFirst(localStateRoute(url), DASHBOARD_STATE, () =>
    readRouteData({
      endpoint: "/dashboard-api/page",
      signal: request.signal,
      isPayload: isDashboardLoaderData,
    }),
  );
}

/** Renders the dashboard overview close to the reference layout. */
export default function DashboardRoute(): React.ReactElement {
  const { t } = useTranslation();
  const {
    displayName,
    hour,
    openTickets,
    openDelta,
    overdueTickets,
    overdueDelta,
    inProgressTickets,
    projectCount,
    newProjects,
    myTasks,
    projectOverview,
    recentlyEdited,
    upcomingDeadlines,
  } = useLocalStateRoute(useLoaderData<typeof clientLoader>(), DASHBOARD_STATE);

  return (
    <section className="flex h-[calc(100dvh-8.5rem)] min-h-0 flex-col overflow-hidden">
      <DashboardHeader displayName={displayName} hour={hour} />

      <DashboardScrollArea>
        <DashboardKpiRow
          openTickets={openTickets}
          openDelta={openDelta}
          overdueTickets={overdueTickets}
          overdueDelta={overdueDelta}
          inProgressTickets={inProgressTickets}
          projectCount={projectCount}
          newProjects={newProjects}
        />

        <div className="grid grid-cols-12 gap-5">
          <DashboardPanel
            className="col-span-12 xl:col-span-6"
            title={t("dashboard.myTasks.title")}
            titleId="dashboard-my-tasks"
            linkLabel={t("dashboard.myTasks.allTasks")}
            linkTo="/aufgaben"
          >
            <DashboardMyTasks tasks={myTasks} />
          </DashboardPanel>
          <DashboardPanel
            className="col-span-12 xl:col-span-6"
            title={t("dashboard.projectOverview.title")}
            titleId="dashboard-project-overview"
            linkLabel={t("dashboard.projectOverview.allProjects")}
            linkTo="/projekte"
          >
            <DashboardProjectOverview projects={projectOverview} />
          </DashboardPanel>
        </div>

        <div className="grid grid-cols-12 gap-5">
          <DashboardPanel
            className="col-span-12 xl:col-span-6"
            title={t("dashboard.recentlyEdited.title")}
            titleId="dashboard-recently-edited"
            linkLabel={t("dashboard.recentlyEdited.showAll")}
            linkTo="/aufgaben"
          >
            <DashboardRecentlyEdited items={recentlyEdited} />
          </DashboardPanel>
          <DashboardPanel
            className="col-span-12 xl:col-span-6"
            title={t("dashboard.deadlines.title")}
            titleId="dashboard-upcoming-deadlines"
            linkLabel={t("dashboard.deadlines.showAll")}
            linkTo="/aufgaben"
          >
            <DashboardUpcomingDeadlines deadlines={upcomingDeadlines} />
          </DashboardPanel>
        </div>
      </DashboardScrollArea>
    </section>
  );
}
