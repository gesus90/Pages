import { useSubmit } from "react-router";

import type {
  ProjectLabel,
  WorkItemDetail,
  WorkItemPriority,
} from "@/definition/Task";

/** The fields a detail panel change can replace; the others keep their value. */
interface PanelUpdate {
  readonly title?: string;
  readonly priority?: WorkItemPriority;
  readonly assigneeId?: string;
  readonly reporterId?: string;
  readonly milestoneId?: string;
  readonly parentId?: string;
  readonly dueAt?: string;
  readonly startAt?: string;
  readonly description?: string;
}

/** The changes the detail panel can submit for its task. */
export interface TaskPanelActions {
  readonly update: (changes: PanelUpdate) => void;
  readonly changeStatus: (statusId: string) => void;
  readonly removeLabel: (label: ProjectLabel) => void;
}

/**
 * Provides the form submissions behind the controls of the detail panel.
 *
 * @param task - The task the panel shows; fields not being changed keep their value.
 */
export function useTaskPanelActions(task: WorkItemDetail): TaskPanelActions {
  const submit = useSubmit();

  function update(changes: PanelUpdate): void {
    void submit(
      {
        assigneeId: changes.assigneeId ?? task.assigneeId ?? "",
        description: changes.description ?? task.description,
        dueAt: changes.dueAt ?? task.dueAt ?? "",
        id: task.id,
        intent: "update-task",
        milestoneId: changes.milestoneId ?? task.milestoneId ?? "",
        parentId: changes.parentId ?? task.parentId ?? "",
        priority: changes.priority ?? task.priority,
        reporterId: changes.reporterId ?? task.createdBy,
        startAt: changes.startAt ?? task.startAt ?? "",
        statusId: task.statusId,
        title: changes.title ?? task.title,
      },
      { method: "post" },
    );
  }

  function changeStatus(statusId: string): void {
    void submit(
      {
        id: task.id,
        intent: "move-task",
        sortOrder: String(task.sortOrder),
        statusId,
      },
      { method: "post" },
    );
  }

  function removeLabel(label: ProjectLabel): void {
    void submit(
      { intent: "label-unassign", labelId: label.id, workItemId: task.id },
      { method: "post" },
    );
  }

  return { changeStatus, removeLabel, update };
}
