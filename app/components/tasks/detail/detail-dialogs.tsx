import { LabelPicker } from "@/app/components/tasks/label-picker";
import { TaskMoveDialog } from "@/app/components/tasks/task-move-dialog";

import type { Project } from "@/definition/Project";
import type { Milestone, Label, WorkItemDetail } from "@/definition/Task";
import type { User } from "@/definition/User";

interface DetailDialogsProps {
  readonly task: WorkItemDetail;
  readonly taskLabels: readonly Label[];
  readonly labels: readonly Label[];
  readonly labelUsage: Readonly<Record<string, number>> | undefined;
  readonly projects: readonly Project[];
  readonly milestones: readonly Milestone[];
  readonly workItems: readonly WorkItemDetail[];
  readonly assigneesByProject: Readonly<Record<string, readonly User[]>>;
  readonly isSyncing: boolean;
  readonly isLabelPickerOpen: boolean;
  readonly isMoveDialogOpen: boolean;
  readonly pendingProjectId: string;
  readonly onLabelPickerOpenChange: (isOpen: boolean) => void;
  readonly onMoveDialogClose: () => void;
}

/** Renders the label picker and the dialog for moving a ticket to another project. */
export function DetailDialogs({
  task,
  taskLabels,
  labels,
  labelUsage,
  projects,
  milestones,
  workItems,
  assigneesByProject,
  isSyncing,
  isLabelPickerOpen,
  isMoveDialogOpen,
  pendingProjectId,
  onLabelPickerOpenChange,
  onMoveDialogClose,
}: DetailDialogsProps): React.ReactElement {
  return (
    <>
      <LabelPicker
        assignedLabelIds={new Set(taskLabels.map((label) => label.id))}
        isOpen={isLabelPickerOpen}
        isSubmitting={isSyncing}
        labelUsage={labelUsage ?? {}}
        onOpenChange={onLabelPickerOpenChange}
        labels={labels}
        workItemId={task.id}
      />

      {isMoveDialogOpen ? (
        <TaskMoveDialog
          assigneesByProject={assigneesByProject}
          initialTargetProjectId={pendingProjectId}
          isOpen={isMoveDialogOpen}
          isSubmitting={isSyncing}
          milestones={milestones}
          onOpenChange={onMoveDialogClose}
          projects={projects}
          task={task}
          taskLabels={taskLabels}
          workItems={workItems}
        />
      ) : null}
    </>
  );
}
