import { useTranslation } from "react-i18next";

import { getMilestoneProgress } from "@/app/components/projects/project-progress";

import { MilestoneTaskList } from "./milestone-task-list";

import type { Milestone, WorkItemDetail } from "@/definition/Task";

interface MilestoneCardProps {
  readonly milestone: Milestone;
  readonly workItems: readonly WorkItemDetail[];
  readonly visibleTaskCount: number;
  readonly onSelectTask: (key: string) => void;
  readonly onOpenTask: (key: string) => void;
  readonly onShowMore: () => void;
}

/** Renders one milestone with its due date, progress and assigned tasks. */
export function MilestoneCard({
  milestone,
  workItems,
  visibleTaskCount,
  onSelectTask,
  onOpenTask,
  onShowMore,
}: MilestoneCardProps): React.ReactElement {
  const { t } = useTranslation();
  const progress = getMilestoneProgress(milestone.id, workItems);
  const assignedTasks = workItems.filter(
    (item) => item.milestoneId === milestone.id,
  );

  return (
    <li className="flex flex-col gap-3 rounded-2xl bg-surface p-5 shadow-card">
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
      <MilestoneTaskList
        assignedTasks={assignedTasks}
        onOpenTask={onOpenTask}
        onSelectTask={onSelectTask}
        onShowMore={onShowMore}
        visibleTaskCount={visibleTaskCount}
      />
    </li>
  );
}
