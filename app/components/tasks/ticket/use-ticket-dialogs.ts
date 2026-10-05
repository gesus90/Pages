import { useEffect, useState } from "react";
import { useActionData, useNavigate } from "react-router";

import { WORK_ITEM_TYPE } from "@/definition/Task";

import type { action } from "@/app/routes/tasks";
import type { WorkItemDetail, WorkItemType } from "@/definition/Task";

/** What the create and edit dialog starts with. */
interface TicketFormDialogState {
  readonly isOpen: boolean;
  readonly mode: "create" | "edit";
  readonly task?: WorkItemDetail | null;
  readonly defaultProjectId?: string | null;
  readonly defaultParentId?: string | null;
  readonly defaultType?: WorkItemType;
  readonly defaultStatusId?: string | null;
}

const CHILD_TYPES: Readonly<Record<WorkItemType, WorkItemType>> = {
  [WORK_ITEM_TYPE.INITIATIVE]: WORK_ITEM_TYPE.EPIC,
  [WORK_ITEM_TYPE.EPIC]: WORK_ITEM_TYPE.TASK,
  [WORK_ITEM_TYPE.TASK]: WORK_ITEM_TYPE.SUBTASK,
  [WORK_ITEM_TYPE.SUBTASK]: WORK_ITEM_TYPE.SUBTASK,
};

const CLOSED_DIALOG: TicketFormDialogState = { isOpen: false, mode: "create" };

/** The dialogs of the ticket page and the actions that open them. */
export interface TicketDialogs {
  readonly formDialog: TicketFormDialogState;
  readonly isLabelPickerOpen: boolean;
  readonly isMoveDialogOpen: boolean;
  readonly setFormDialogOpen: (isOpen: boolean) => void;
  readonly setIsLabelPickerOpen: (isOpen: boolean) => void;
  readonly setIsMoveDialogOpen: (isOpen: boolean) => void;
  readonly openEdit: () => void;
  readonly openCreateChild: () => void;
}

/**
 * Keeps the dialog state of the ticket page.
 *
 * @remarks
 * A successful create or project move leads to the new ticket; a successful
 * update only closes the edit dialog.
 *
 * @param ticket - The ticket the page shows.
 * @param fromView - The task view the visitor came from, kept in links.
 */
export function useTicketDialogs(
  ticket: WorkItemDetail,
  fromView: string,
): TicketDialogs {
  const actionData = useActionData<typeof action>();
  const navigate = useNavigate();
  const [formDialog, setFormDialog] =
    useState<TicketFormDialogState>(CLOSED_DIALOG);
  const [isLabelPickerOpen, setIsLabelPickerOpen] = useState(false);
  const [isMoveDialogOpen, setIsMoveDialogOpen] = useState(false);

  useEffect(() => {
    if (!actionData || !actionData.ok || !actionData.key) {
      return;
    }

    if (
      actionData.intent === "create-task" ||
      actionData.intent === "move-project"
    ) {
      setFormDialog(CLOSED_DIALOG);
      setIsMoveDialogOpen(false);
      void navigate(`/aufgaben/${actionData.key}?from=${fromView}`);
    } else if (actionData.intent === "update-task") {
      setFormDialog(CLOSED_DIALOG);
    }
  }, [actionData, fromView, navigate]);

  return {
    formDialog,
    isLabelPickerOpen,
    isMoveDialogOpen,
    openCreateChild: () =>
      setFormDialog({
        defaultParentId: ticket.id,
        defaultProjectId: ticket.projectId,
        defaultType: CHILD_TYPES[ticket.type],
        isOpen: true,
        mode: "create",
      }),
    openEdit: () => setFormDialog({ isOpen: true, mode: "edit", task: ticket }),
    setFormDialogOpen: (isOpen) =>
      setFormDialog((previous) => ({ ...previous, isOpen })),
    setIsLabelPickerOpen,
    setIsMoveDialogOpen,
  };
}
