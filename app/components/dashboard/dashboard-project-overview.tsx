import { useTranslation } from "react-i18next";

import { DashboardFolderIcon } from "@/app/components/dashboard/dashboard-icons";

/** A single project row shown in the project overview panel. */
export interface DashboardProjectEntry {
  readonly id: string;
  readonly name: string;
  readonly done: number;
  readonly total: number;
  readonly percentage: number;
}

interface DashboardProjectOverviewProps {
  readonly projects: readonly DashboardProjectEntry[];
}

/**
 * Renders the project list with progress bars.
 *
 * @param props - Projects to display, already sorted by the route loader.
 * @returns The project overview list element.
 */
export function DashboardProjectOverview({
  projects,
}: DashboardProjectOverviewProps): React.ReactElement {
  const { t } = useTranslation();

  if (projects.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        {t("dashboard.projectOverview.empty")}
      </p>
    );
  }

  return (
    <div>
      <div
        className="flex items-center justify-between border-b border-border/60 pb-2 text-xs font-medium text-muted-foreground"
        aria-hidden="true"
      >
        <span>{t("dashboard.projectOverview.columns.project")}</span>
        <span>{t("dashboard.projectOverview.columns.progress")}</span>
      </div>
      <ul className="divide-y divide-border/60">
        {projects.map((project) => (
          <li key={project.id} className="flex items-center gap-4 py-3">
            <span className="inline-flex size-10 shrink-0 select-none items-center justify-center rounded-xl bg-muted text-muted-foreground">
              <DashboardFolderIcon className="size-5" />
            </span>
            <div className="w-2/5 min-w-0">
              <p className="truncate text-sm font-medium text-foreground">
                {project.name}
              </p>
              <p className="truncate text-xs text-muted-foreground tabular-nums">
                {t("dashboard.projectOverview.taskCount", {
                  done: project.done,
                  total: project.total,
                })}
              </p>
            </div>
            <div
              className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuenow={project.percentage}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={project.name}
            >
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${project.percentage}%` }}
              />
            </div>
            <span className="w-11 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
              {project.percentage}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
