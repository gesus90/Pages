import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

/** A single task row shown in the "My tasks" panel. */
export interface DashboardMyTask {
  readonly id: string;
  readonly title: string;
  readonly projectName: string;
  readonly dueAt: string | null;
  readonly isOverdue: boolean;
  readonly isDueToday: boolean;
}

interface DashboardMyTasksProps {
  readonly tasks: readonly DashboardMyTask[];
}

/**
 * Renders the structured task list of the "My tasks" panel.
 *
 * @param props - Tasks to display, already sorted by the route loader.
 * @returns The task list element.
 */
export function DashboardMyTasks({
  tasks,
}: DashboardMyTasksProps): React.ReactElement {
  const { t, i18n } = useTranslation();

  function formatDueDate(dueAt: string): string {
    const locale = i18n.language === "en" ? "en-GB" : "de-DE";

    return new Intl.DateTimeFormat(locale, {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(new Date(dueAt));
  }

  function formatDueLabel(task: DashboardMyTask): string {
    if (task.dueAt === null) {
      return t("dashboard.myTasks.noDueDate");
    }

    if (task.isDueToday) {
      return t("dashboard.myTasks.today");
    }

    return formatDueDate(task.dueAt);
  }

  if (tasks.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        {t("dashboard.myTasks.empty")}
      </p>
    );
  }

  return (
    <div>
      <div
        className="grid grid-cols-[minmax(0,1fr)_auto_110px] items-center gap-3 border-b border-border/60 pb-2 text-xs font-medium text-muted-foreground"
        aria-hidden="true"
      >
        <span>{t("dashboard.myTasks.columns.task")}</span>
        <span className="w-20">{t("dashboard.myTasks.columns.project")}</span>
        <span className="text-right">{t("dashboard.myTasks.columns.due")}</span>
      </div>
      <ul className="divide-y divide-border/60">
        {tasks.map((task) => (
          <li
            key={task.id}
            className="grid grid-cols-[minmax(0,1fr)_auto_110px] items-center gap-3 py-3"
          >
            <div className="flex min-w-0 items-start gap-3">
              <span
                className={cn(
                  "mt-1.5 size-3.5 shrink-0 rounded-full",
                  task.isOverdue
                    ? "bg-primary"
                    : "border-2 border-muted-foreground/40 bg-transparent",
                )}
                aria-hidden="true"
              />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">
                  {task.title}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {task.projectName}
                </p>
              </div>
            </div>
            <span className="w-20">
              {task.isOverdue ? (
                <span className="inline-flex items-center rounded-full bg-destructive/10 px-2.5 py-0.5 text-xs font-medium text-destructive">
                  {t("dashboard.myTasks.overdueBadge")}
                </span>
              ) : null}
            </span>
            <span
              className={cn(
                "truncate text-right text-xs tabular-nums",
                task.isOverdue && "font-medium text-destructive",
                task.isDueToday && "font-medium text-primary",
                !task.isOverdue && !task.isDueToday && "text-muted-foreground",
              )}
            >
              {formatDueLabel(task)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
