import { useActionData } from "react-router";

import { LabelPicker } from "@/app/components/tasks/label-picker";
import { TaskFormDialog } from "@/app/components/tasks/task-form-dialog";
import { TaskMoveDialog } from "@/app/components/tasks/task-move-dialog";

import type { TicketDialogs as TicketDialogState } from "@/app/components/tasks/ticket/use-ticket-dialogs";
import type { action } from "@/app/routes/tasks";
import type { loader } from "@/app/routes/task-detail";

interface TicketDialogsProps {
  readonly loaderData: Awaited<ReturnType<typeof loader>>;
  readonly dialogs: TicketDialogState;
  readonly isSubmittingForm: boolean;
  readonly isSyncing: boolean;
}

/** Renders the edit dialog, the label picker and the move dialog of a ticket. */
export function TicketDialogs({
  loaderData,
  dialogs,
  isSubmittingForm,
  isSyncing,
}: TicketDialogsProps): React.ReactElement {
  const actionData = useActionData<typeof action>();
  const { ticket, assignees, milestones, statuses } = loaderData;

  return (
    <>
      <TaskFormDialog
        assignees={assignees}
        defaultParentId={dialogs.formDialog.defaultParentId}
        defaultProjectId={dialogs.formDialog.defaultProjectId}
        defaultStatusId={dialogs.formDialog.defaultStatusId}
        defaultType={dialogs.formDialog.defaultType}
        error={actionData && !actionData.ok ? actionData.error : null}
        existingWorkItems={loaderData.projectWorkItems}
        initialTask={dialogs.formDialog.task}
        isOpen={dialogs.formDialog.isOpen}
        isSubmitting={isSubmittingForm}
        milestones={milestones}
        mode={dialogs.formDialog.mode}
        onOpenChange={dialogs.setFormDialogOpen}
        projects={loaderData.projects}
        statuses={statuses}
      />

      <LabelPicker
        assignedLabelIds={
          new Set(loaderData.taskLabels.map((label) => label.id))
        }
        isOpen={dialogs.isLabelPickerOpen}
        isSubmitting={isSyncing}
        labelUsage={loaderData.labelUsage}
        onOpenChange={dialogs.setIsLabelPickerOpen}
        projectId={ticket.projectId}
        projectLabels={loaderData.projectLabels}
        workItemId={ticket.id}
      />

      {dialogs.isMoveDialogOpen ? (
        <TaskMoveDialog
          assigneesByProject={loaderData.assigneesByProject}
          isOpen={dialogs.isMoveDialogOpen}
          isSubmitting={isSyncing}
          milestones={milestones}
          onOpenChange={dialogs.setIsMoveDialogOpen}
          projects={loaderData.projects}
          task={ticket}
          taskLabels={loaderData.taskLabels}
          workItems={loaderData.projectWorkItems}
        />
      ) : null}
    </>
  );
}
