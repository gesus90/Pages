import { CheckSquare } from "lucide-react";
import { useTranslation } from "react-i18next";

import { UserAvatar } from "@/app/components/common/user-avatar";
import {
  TaskPriorityBadge,
  TaskTypeBadge,
} from "@/app/components/tasks/task-badges";
import { TaskLabelList } from "@/app/components/tasks/task-labels";
import { cn } from "@/app/lib/cn";

import type { ProjectLabel, WorkItemDetail } from "@/definition/Task";

interface KanbanTicketCardProps {
  readonly item: WorkItemDetail;
  readonly labels: readonly ProjectLabel[];
  readonly isSelected: boolean;
  readonly isBeingDragged: boolean;
  readonly onSelectTask: (key: string) => void;
  readonly onOpenTask: (key: string) => void;
  readonly onDragStart: (
    event: React.DragEvent<HTMLElement>,
    taskId: string,
  ) => void;
  readonly onDragEnd: () => void;
}

/** Renders one draggable ticket card of a kanban column. */
export function KanbanTicketCard({
  item,
  labels,
  isSelected,
  isBeingDragged,
  onSelectTask,
  onOpenTask,
  onDragStart,
  onDragEnd,
}: KanbanTicketCardProps): React.ReactElement {
  const { t } = useTranslation();

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelectTask(item.key);
    }
  }

  return (
    <div
      className={cn(
        "group relative cursor-grab rounded-2xl bg-surface p-4 shadow-card transition-shadow outline-none select-none hover:shadow-floating focus-visible:ring-2 focus-visible:ring-primary active:cursor-grabbing",
        isSelected && "ring-2 ring-primary",
        isBeingDragged ? "opacity-40" : "opacity-100",
      )}
      data-ticket-item
      draggable
      onClick={() => onSelectTask(item.key)}
      onDoubleClick={() => onOpenTask(item.key)}
      onDragEnd={onDragEnd}
      onDragStart={(event) => onDragStart(event, item.id)}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
    >
      <div className="flex items-start justify-between gap-2">
        <TaskTypeBadge type={item.type} />
        <span className="flex items-center gap-1.5">
          {item.githubIssueNumber !== null ? (
            <span
              className="size-2 rounded-full bg-emerald-500"
              title={t("tasks.github.synchronized")}
              aria-hidden="true"
            />
          ) : null}
          <span className="text-[11px] font-semibold tracking-wide text-muted-foreground">
            {item.key}
          </span>
        </span>
      </div>

      <h4 className="mt-2.5 line-clamp-2 text-sm font-semibold text-foreground">
        {item.title}
      </h4>

      <p className="mt-1 text-[11px] font-medium text-muted-foreground">
        {item.projectName}
      </p>

      {labels.length > 0 ? (
        <div className="mt-2.5">
          <TaskLabelList labels={labels} maxVisible={3} />
        </div>
      ) : null}

      <div className="mt-3.5 flex items-center justify-between gap-2 text-xs">
        <TaskPriorityBadge priority={item.priority} />

        <div className="flex items-center gap-2">
          {item.subtaskTotal > 0 ? (
            <span className="inline-flex items-center gap-1 font-medium text-muted-foreground">
              <CheckSquare className="size-3.5" aria-hidden="true" />
              {item.subtaskCompleted} / {item.subtaskTotal}
            </span>
          ) : null}

          {item.assigneeName ? (
            <UserAvatar
              name={item.assigneeName}
              size="xs"
              className="bg-muted text-muted-foreground"
              title={item.assigneeName}
            />
          ) : (
            <span
              className="inline-flex size-6 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground select-none"
              title={t("tasks.unassigned")}
            >
              ?
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
