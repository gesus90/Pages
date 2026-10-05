import { useActionData } from "react-router";

import { TaskFormDialog } from "@/app/components/tasks/task-form-dialog";

import type { TasksDialog } from "@/app/components/tasks/board/use-tasks-dialog";
import type { action, loader } from "@/app/routes/tasks";

interface TasksFormDialogProps {
  readonly loaderData: Awaited<ReturnType<typeof loader>>;
  readonly dialog: TasksDialog;
  readonly isSubmitting: boolean;
}

/** Renders the dialog for creating and editing tickets, with the error of the last try. */
export function TasksFormDialog({
  loaderData,
  dialog,
  isSubmitting,
}: TasksFormDialogProps): React.ReactElement {
  const actionData = useActionData<typeof action>();
  const { dialogState } = dialog;

  return (
    <TaskFormDialog
      assignees={loaderData.assignees}
      defaultParentId={dialogState.defaultParentId}
      defaultProjectId={dialogState.defaultProjectId}
      defaultStatusId={dialogState.defaultStatusId}
      defaultType={dialogState.defaultType}
      error={actionData && !actionData.ok ? actionData.error : null}
      existingWorkItems={loaderData.workItems}
      initialTask={dialogState.task}
      isOpen={dialogState.isOpen}
      isSubmitting={isSubmitting}
      milestones={loaderData.milestones}
      mode={dialogState.mode}
      onOpenChange={dialog.setOpen}
      projects={loaderData.projects}
      statuses={loaderData.statuses}
    />
  );
}
