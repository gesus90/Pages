import { useEffect, useRef, useState } from "react";
import { useActionData, useNavigate, useSearchParams } from "react-router";

import { WORK_ITEM_CHILD_TYPE, WORK_ITEM_TYPE } from "@/definition/Task";

import type { action } from "@/app/routes/tasks";
import type { WorkItemDetail, WorkItemType } from "@/definition/Task";

/** What the create and edit dialog starts with, and which ticket is selected. */
interface TasksDialogState {
  readonly isOpen: boolean;
  readonly mode: "create" | "edit";
  readonly selectedTaskId?: string | null;
  readonly task?: WorkItemDetail | null;
  readonly defaultProjectId?: string | null;
  readonly defaultParentId?: string | null;
  readonly defaultType?: WorkItemType;
  readonly defaultStatusId?: string | null;
}

/** Results after which the dialog closes and the ticket they name opens. */
const OPENING_INTENTS: ReadonlySet<string> = new Set([
  "create-task",
  "update-task",
  "github-import-issue",
  "github-link-issue",
  "github-resolve-conflict",
  "move-project",
]);

/** The dialog and selection of the tasks page and the actions that change them. */
export interface TasksDialog {
  readonly dialogState: TasksDialogState;
  readonly selectedTaskId: string | null;
  readonly setOpen: (isOpen: boolean) => void;
  readonly select: (key: string) => void;
  readonly openTask: (key: string) => void;
  readonly closeDetail: () => void;
  readonly openCreate: () => void;
  readonly quickCreate: (statusId: string) => void;
  readonly createSubtask: (parentTask: WorkItemDetail) => void;
  readonly editTask: (task: WorkItemDetail) => void;
}

/**
 * Keeps the dialog and the selected ticket of the tasks page.
 *
 * @remarks
 * A finished create, update, import, link, resolve or move opens the resulting
 * ticket in the detail panel; archiving closes the panel.
 *
 * @param selectedKey - Key of the ticket the page address selects.
 * @param filterProject - The project filter, which new tickets start in.
 */
export function useTasksDialog(
  selectedKey: string | null,
  filterProject: string,
): TasksDialog {
  const actionData = useActionData<typeof action>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [dialogState, setDialogState] = useState<TasksDialogState>({
    isOpen: false,
    mode: "create",
    selectedTaskId: selectedKey,
  });
  const selectedTaskId = selectedKey ?? dialogState.selectedTaskId ?? null;
  const defaultProjectId = filterProject !== "all" ? filterProject : null;

  useEffect(() => {
    if (!actionData || !actionData.ok) {
      return;
    }

    const params = new URLSearchParams(searchParams);

    if (OPENING_INTENTS.has(actionData.intent)) {
      setDialogState((previous) => ({ ...previous, isOpen: false }));

      if (actionData.key) {
        const key = actionData.key;

        setDialogState((previous) => ({ ...previous, selectedTaskId: key }));
        params.set("item", key);
        void navigate(`?${params.toString()}`);
      }
    } else if (actionData.intent === "archive-task") {
      params.delete("item");
      void navigate(`?${params.toString()}`);
    }
  }, [actionData, navigate, searchParams]);

  // The card or row that opened the panel gets the focus back when the panel
  // closes (A8.2-E10); opening another ticket inside the panel keeps it.
  const opener = useRef<HTMLElement | null>(null);

  function openTask(key: string): void {
    const params = new URLSearchParams(searchParams);
    const active = document.activeElement;

    if (
      active instanceof HTMLElement &&
      active.closest('[role="dialog"]') === null
    ) {
      opener.current = active;
    }

    setDialogState((previous) => ({ ...previous, selectedTaskId: key }));
    params.set("item", key);
    void navigate(`?${params.toString()}`);
  }

  function closeDetail(): void {
    const params = new URLSearchParams(searchParams);
    const target = opener.current;

    params.delete("item");
    opener.current = null;
    void Promise.resolve(navigate(`?${params.toString()}`)).then(() =>
      target?.focus(),
    );
  }

  return {
    closeDetail,
    createSubtask: (parentTask) =>
      setDialogState({
        defaultParentId: parentTask.id,
        defaultProjectId: parentTask.projectId,
        defaultType:
          WORK_ITEM_CHILD_TYPE[parentTask.type] ?? WORK_ITEM_TYPE.SUBTASK,
        isOpen: true,
        mode: "create",
        selectedTaskId,
      }),
    dialogState,
    editTask: (task) =>
      setDialogState({ isOpen: true, mode: "edit", selectedTaskId, task }),
    openCreate: () =>
      setDialogState({
        defaultProjectId,
        defaultType: WORK_ITEM_TYPE.TASK,
        isOpen: true,
        mode: "create",
        selectedTaskId,
      }),
    openTask,
    quickCreate: (statusId) =>
      setDialogState({
        defaultProjectId,
        defaultStatusId: statusId,
        defaultType: WORK_ITEM_TYPE.TASK,
        isOpen: true,
        mode: "create",
        selectedTaskId,
      }),
    select: (key) =>
      setDialogState((previous) => ({ ...previous, selectedTaskId: key })),
    selectedTaskId,
    setOpen: (isOpen) =>
      setDialogState((previous) => ({ ...previous, isOpen })),
  };
}
