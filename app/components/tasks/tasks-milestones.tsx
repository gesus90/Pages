import { useState } from "react";
import { useTranslation } from "react-i18next";

import { TaskStatusBadge } from "@/app/components/tasks/task-badges";
import { getMilestoneProgress } from "@/app/components/projects/project-progress";

import type { Milestone, WorkItemDetail } from "@/definition/Task";

interface TasksMilestonesProps {
  readonly milestones: readonly Milestone[];
  readonly workItems: readonly WorkItemDetail[];
  readonly onSelectTask: (key: string) => void;
  readonly onOpenTask: (key: string) => void;
}

// Task rows rendered per milestone before progressive disclosure; progress
// totals always come from the full item list.
const MILESTONE_TASK_PAGE_SIZE = 10;

/** Renders milestones as temporal checkpoints with their referenced tasks. */
export function TasksMilestones({
  milestones,
  workItems,
  onSelectTask,
  onOpenTask,
}: TasksMilestonesProps): React.ReactElement {
  const { t } = useTranslation();
  const [visibleTaskCount, setVisibleTaskCount] = useState<number>(
    MILESTONE_TASK_PAGE_SIZE,
  );

  function handleShowMore(): void {
    setVisibleTaskCount((count) => count + MILESTONE_TASK_PAGE_SIZE);
  }

  if (milestones.length === 0) {
    return (
      <p className="rounded-2xl bg-muted/40 p-10 text-center text-sm text-muted-foreground">
        {t("tasks.milestones.empty")}
      </p>
    );
  }

  return (
    <ul className="grid gap-4 lg:grid-cols-2">
      {milestones.map((milestone) => {
        const progress = getMilestoneProgress(milestone.id, workItems);
        const assignedTasks = workItems.filter(
          (item) => item.milestoneId === milestone.id,
        );
        const visibleTasks = assignedTasks.slice(0, visibleTaskCount);
        const hiddenCount = assignedTasks.length - visibleTasks.length;

        return (
          <li
            key={milestone.id}
            className="flex flex-col gap-3 rounded-2xl bg-surface p-5 shadow-card"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="truncate text-base font-semibold text-foreground">
                  {milestone.name}
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {milestone.dueAt ?? t("tasks.milestones.noDueDate")}
                </p>
              </div>
              <span className="shrink-0 text-lg font-bold text-foreground">
                {progress.percentage} %
              </span>
            </div>
            {milestone.description ? (
              <p className="line-clamp-2 text-sm text-muted-foreground">
                {milestone.description}
              </p>
            ) : null}
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${progress.percentage}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {progress.done} / {progress.total} {t("tasks.milestones.tasks")}
            </p>
            {assignedTasks.length > 0 ? (
              <ul className="flex flex-col gap-1.5 pt-3">
                {visibleTasks.map((task) => (
                  <li key={task.id}>
                    <button
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-muted"
                      onClick={() => onSelectTask(task.key)}
                      onDoubleClick={() => onOpenTask(task.key)}
                      type="button"
                    >
                      <span className="shrink-0 font-mono text-xs font-semibold text-muted-foreground">
                        {task.key}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                        {task.title}
                      </span>
                      <TaskStatusBadge
                        statusKey={task.statusKey}
                        statusName={task.statusName}
                      />
                    </button>
                  </li>
                ))}
                {hiddenCount > 0 ? (
                  <li>
                    <button
                      className="inline-flex min-h-8 w-full items-center justify-center rounded-lg px-2 text-xs font-semibold text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
                      onClick={handleShowMore}
                      type="button"
                    >
                      {t("tasks.view.showMore", { count: hiddenCount })}
                    </button>
                  </li>
                ) : null}
              </ul>
            ) : (
              <p className="pt-3 text-xs text-muted-foreground">
                {t("tasks.milestones.noTasks")}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
