import { CheckCircle2, Circle, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";

import { UserAvatar } from "@/app/components/common/user-avatar";
import { DetailSection } from "@/app/components/tasks/detail-section";
import { Button } from "@/app/components/ui/button";
import { WORK_ITEM_TYPE } from "@/definition/Task";
import { cn } from "@/app/lib/cn";

import type { WorkItemDetail } from "@/definition/Task";

interface DetailChildrenSectionProps {
  readonly task: WorkItemDetail;
  readonly subtasks: readonly WorkItemDetail[];
  readonly isArchived: boolean;
  readonly onCreateSubtask: (parentTask: WorkItemDetail) => void;
  readonly onSelectTask: (key: string) => void;
  readonly onOpenTask: (key: string) => void;
}

/** Renders the subtasks of a task, or the tasks an epic contains. */
export function DetailChildrenSection({
  task,
  subtasks,
  isArchived,
  onCreateSubtask,
  onSelectTask,
  onOpenTask,
}: DetailChildrenSectionProps): React.ReactElement {
  const { t } = useTranslation();
  const isEpic = task.type === WORK_ITEM_TYPE.EPIC;

  return (
    <DetailSection
      title={
        isEpic ? t("tasks.detail.containedTasks") : t("tasks.tabs.subtasks")
      }
      trailing={
        !isArchived ? (
          <Button
            className="h-8 shrink-0 gap-1.5 px-3 text-xs"
            onClick={() => onCreateSubtask(task)}
            type="button"
            variant="outline"
          >
            <Plus className="size-3.5" aria-hidden="true" />
            {isEpic
              ? t("tasks.create.trigger")
              : t("tasks.actions.createSubtask")}
          </Button>
        ) : (
          <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-foreground">
            {task.subtaskCompleted} / {task.subtaskTotal}
          </span>
        )
      }
    >
      {subtasks.length === 0 ? (
        <p className="py-4 text-center text-xs text-muted-foreground">
          {t("tasks.none")}
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {subtasks.map((child) => (
            <li key={child.id}>
              <button
                className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left text-sm transition-colors hover:bg-muted/60"
                onClick={() => onSelectTask(child.key)}
                onDoubleClick={() => onOpenTask(child.key)}
                type="button"
              >
                {child.isDone ? (
                  <CheckCircle2
                    className="size-4 shrink-0 text-emerald-500"
                    aria-hidden="true"
                  />
                ) : (
                  <Circle
                    className="size-4 shrink-0 text-muted-foreground/60"
                    aria-hidden="true"
                  />
                )}
                <span className="shrink-0 text-xs font-semibold text-muted-foreground">
                  {child.key}
                </span>
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate font-medium",
                    child.isDone
                      ? "text-muted-foreground line-through"
                      : "text-foreground",
                  )}
                >
                  {child.title}
                </span>
                {child.assigneeName ? (
                  <UserAvatar
                    name={child.assigneeName}
                    size="xs"
                    className="bg-muted text-muted-foreground"
                    title={child.assigneeName}
                  />
                ) : (
                  <span
                    className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground select-none"
                    title={t("tasks.unassigned")}
                  >
                    ?
                  </span>
                )}
                <span className="w-16 shrink-0 text-right text-xs font-medium text-muted-foreground">
                  {child.dueAt ?? ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </DetailSection>
  );
}
