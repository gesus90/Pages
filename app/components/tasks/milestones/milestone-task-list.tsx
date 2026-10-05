import { useTranslation } from "react-i18next";

import { TaskStatusBadge } from "@/app/components/tasks/task-badges";

import type { WorkItemDetail } from "@/definition/Task";

interface MilestoneTaskListProps {
  readonly assignedTasks: readonly WorkItemDetail[];
  readonly visibleTaskCount: number;
  readonly onSelectTask: (key: string) => void;
  readonly onOpenTask: (key: string) => void;
  readonly onShowMore: () => void;
}

/** Renders the tasks assigned to a milestone, with progressive disclosure. */
export function MilestoneTaskList({
  assignedTasks,
  visibleTaskCount,
  onSelectTask,
  onOpenTask,
  onShowMore,
}: MilestoneTaskListProps): React.ReactElement {
  const { t } = useTranslation();
  const visibleTasks = assignedTasks.slice(0, visibleTaskCount);
  const hiddenCount = assignedTasks.length - visibleTasks.length;

  if (assignedTasks.length === 0) {
    return (
      <p className="pt-3 text-xs text-muted-foreground">
        {t("tasks.milestones.noTasks")}
      </p>
    );
  }

  return (
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
            onClick={onShowMore}
            type="button"
          >
            {t("tasks.view.showMore", { count: hiddenCount })}
          </button>
        </li>
      ) : null}
    </ul>
  );
}
