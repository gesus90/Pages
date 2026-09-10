import { useTranslation } from "react-i18next";
import { useLoaderData } from "react-router";

import { DashboardKpiCard } from "@/app/components/dashboard/dashboard-kpi-card";
import {
  DashboardClockIcon,
  DashboardDocumentIcon,
  DashboardFolderIcon,
  DashboardRefreshIcon,
} from "@/app/components/dashboard/dashboard-icons";
import { DashboardMyTasks } from "@/app/components/dashboard/dashboard-my-tasks";
import { DashboardPanel } from "@/app/components/dashboard/dashboard-panel";
import { DashboardProjectOverview } from "@/app/components/dashboard/dashboard-project-overview";
import { DashboardRecentlyEdited } from "@/app/components/dashboard/dashboard-recently-edited";
import { DashboardScrollArea } from "@/app/components/dashboard/dashboard-scroll-area";
import { DashboardUpcomingDeadlines } from "@/app/components/dashboard/dashboard-upcoming-deadlines";
import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";

import type { DashboardDeadline } from "@/app/components/dashboard/dashboard-upcoming-deadlines";
import type { DashboardMyTask } from "@/app/components/dashboard/dashboard-my-tasks";
import type { DashboardProjectEntry } from "@/app/components/dashboard/dashboard-project-overview";
import type { DashboardRecentItem } from "@/app/components/dashboard/dashboard-recently-edited";
import type { ProjectWorkItemCounts } from "@/backend/database/repositories/TaskRepository";
import type { Project } from "@/definition/Project";
import type { WorkItemDetail } from "@/definition/Task";
import type { LoaderFunctionArgs } from "react-router";

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
}

function getGreetingKey(hour: number): string {
  if (hour < 12) {
    return "dashboard.greeting.morning";
  }

  if (hour < 18) {
    return "dashboard.greeting.day";
  }

  return "dashboard.greeting.evening";
}

function startOfToday(now: number): number {
  const day = new Date(now);

  day.setHours(0, 0, 0, 0);

  return day.getTime();
}

function formatTimestamp(value: number): string {
  const date = new Date(value);
  const pad = (part: number): string => String(part).padStart(2, "0");

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * Formats an instant as its UTC calendar date for due-date comparisons.
 *
 * @remarks
 * Due dates are stored without time zones while the dashboard compares them
 * against local midnights; the UTC date of that midnight reproduces the
 * previous `Date.parse` comparison semantics in every time zone.
 */
function formatUtcDate(value: number): string {
  return new Date(value).toISOString().slice(0, 10);
}

function isSameDay(first: number, second: number): boolean {
  const firstDay = new Date(first);
  const secondDay = new Date(second);

  return (
    firstDay.getFullYear() === secondDay.getFullYear() &&
    firstDay.getMonth() === secondDay.getMonth() &&
    firstDay.getDate() === secondDay.getDate()
  );
}

function formatDelta(value: number): string {
  if (value === 0) {
    return "±0";
  }

  return `+${value}`;
}

function compareByUpdatedAtDesc(first: Project, second: Project): number {
  return second.updatedAt.localeCompare(first.updatedAt);
}

function toDashboardMyTask(
  item: WorkItemDetail,
  now: number,
  todayStart: number,
): DashboardMyTask {
  const dueTime = item.dueAt === null ? null : Date.parse(item.dueAt);

  return {
    dueAt: item.dueAt,
    id: item.id,
    isDueToday:
      dueTime !== null && !Number.isNaN(dueTime) && isSameDay(dueTime, now),
    isOverdue:
      !item.isDone &&
      dueTime !== null &&
      !Number.isNaN(dueTime) &&
      dueTime < todayStart,
    projectName: item.projectName,
    title: item.title,
  };
}

function toProjectOverviewEntry(
  project: Project,
  countsByProject: ReadonlyMap<string, ProjectWorkItemCounts>,
): DashboardProjectEntry {
  const counts = countsByProject.get(project.id) ?? { done: 0, total: 0 };

  return {
    done: counts.done,
    id: project.id,
    name: project.name,
    percentage:
      counts.total === 0
        ? Math.min(100, Math.max(0, Math.round(project.progress)))
        : Math.round((counts.done / counts.total) * 100),
    total: counts.total,
  };
}

function toDashboardRecentItem(item: WorkItemDetail): DashboardRecentItem {
  return {
    id: item.id,
    projectName: item.projectName,
    title: item.title,
    updatedAt: item.updatedAt,
  };
}

function toDashboardDeadline(
  item: WorkItemDetail,
  todayStart: number,
): DashboardDeadline {
  const dueTime = Date.parse(item.dueAt ?? "");
  const daysLeft = Number.isNaN(dueTime)
    ? 0
    : Math.max(0, Math.ceil((startOfToday(dueTime) - todayStart) / 86_400_000));

  return {
    daysLeft,
    dueAt: item.dueAt ?? "",
    id: item.id,
    projectName: item.projectName,
    title: item.title,
  };
}

/**
 * Returns the personalized greeting plus aggregated dashboard numbers.
 *
 * @param context - Route context holding the authenticated user.
 * @returns Greeting data and every dashboard section.
 */
export async function loader({
  context,
}: LoaderFunctionArgs): Promise<DashboardLoaderData> {
  const user = context.get(authenticatedUserContext);

  if (!user) {
    throw new Error("Authenticated middleware did not provide a user.");
  }

  const now = Date.now();
  const todayStart = startOfToday(now);
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
  const monthAgo = now - 30 * 24 * 60 * 60 * 1000;
  const services = await getApplicationServices();
  const projects = await services.projectService.findAll(user);
  const projectIds = projects.map((project) => project.id);

  const overview = await services.taskService.countWorkItemsOverview(
    projectIds,
    {
      todayDate: formatUtcDate(todayStart),
      userId: user.id,
      weekAgoStart: formatTimestamp(weekAgo),
      yesterdayDate: formatUtcDate(todayStart - 86_400_000),
    },
  );
  const countsByProject =
    await services.taskService.countWorkItemsByProject(projectIds);

  const assignedTop = await services.taskService.findAll(user, {
    archived: "active",
    assigneeId: user.id,
    limit: 5,
    openOnly: true,
    orderBy: "due_nulls_last",
  });
  let myTaskItems = assignedTop;

  if (assignedTop.length === 0) {
    myTaskItems = await services.taskService.findAll(user, {
      archived: "active",
      limit: 5,
      openOnly: true,
      orderBy: "due_nulls_last",
    });
  }

  const myTasks: DashboardMyTask[] = myTaskItems.map((item) =>
    toDashboardMyTask(item, now, todayStart),
  );

  const projectOverview: DashboardProjectEntry[] = projects
    .slice()
    .sort(compareByUpdatedAtDesc)
    .slice(0, 4)
    .map((project) => toProjectOverviewEntry(project, countsByProject));

  const recentlyEdited: DashboardRecentItem[] = (
    await services.taskService.findAll(user, {
      archived: "active",
      limit: 4,
      orderBy: "updated_desc",
    })
  ).map((item) => toDashboardRecentItem(item));

  const upcomingDeadlines: DashboardDeadline[] = (
    await services.taskService.findAll(user, {
      archived: "active",
      hasDueDate: true,
      limit: 3,
      openOnly: true,
      orderBy: "due_asc",
    })
  ).map((item) => toDashboardDeadline(item, todayStart));

  return {
    displayName: user.displayName,
    hour: new Date().getHours(),
    inProgressTickets: overview.inProgress,
    myTasks,
    newProjects: projects.filter(
      (project) => Date.parse(project.createdAt) >= monthAgo,
    ).length,
    openDelta: overview.openDelta,
    openTickets: overview.open,
    overdueDelta: overview.overdueDelta,
    overdueTickets: overview.overdue,
    projectCount: projects.length,
    projectOverview,
    recentlyEdited,
    upcomingDeadlines,
  };
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
  } = useLoaderData<typeof loader>();

  return (
    <section className="flex h-[calc(100dvh-8.5rem)] min-h-0 flex-col overflow-hidden">
      <header className="shrink-0 px-1 pt-1 pb-5">
        <h1 className="select-none text-3xl font-bold tracking-tight text-foreground xl:text-4xl">
          {t(getGreetingKey(hour), { name: displayName })}
        </h1>
        <p className="mt-1 text-base text-muted-foreground select-none">
          {t("dashboard.subtitle")}
        </p>
      </header>

      <DashboardScrollArea>
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
