import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useActionData } from "react-router";

import { DetailBody } from "@/app/components/tasks/detail/detail-body";
import { DetailHeader } from "@/app/components/tasks/detail/detail-header";
import { useTaskPanelActions } from "@/app/components/tasks/detail/use-task-panel-actions";
import { LabelPicker } from "@/app/components/tasks/label-picker";
import { TaskMoveDialog } from "@/app/components/tasks/task-move-dialog";

import type { action } from "@/app/routes/tasks-server";
import type { GitHubPullRequest } from "@/definition/GitHub";
import type { Project } from "@/definition/Project";
import type {
  Label,
  Milestone,
  WorkItemAttachment,
  WorkItemChecklistItem,
  WorkItemDescendants,
  WorkItemDetail,
  WorkItemHistory,
  WorkItemLink,
  WorkflowStatus,
} from "@/definition/Task";
import type { User } from "@/definition/User";

interface TaskDetailPanelProps {
  readonly task: WorkItemDetail;
  readonly subtasks: readonly WorkItemDetail[];
  readonly history: readonly WorkItemHistory[];
  readonly checklist?: readonly WorkItemChecklistItem[];
  readonly links?: readonly WorkItemLink[];
  readonly attachments?: readonly WorkItemAttachment[];
  /** The descendants archiving or deleting reaches; `null` when unknown. */
  readonly descendants?: WorkItemDescendants | null;
  readonly pullRequests?: readonly GitHubPullRequest[];
  readonly statuses: readonly WorkflowStatus[];
  readonly assignees?: readonly User[];
  readonly milestones?: readonly Milestone[];
  readonly projects?: readonly Project[];
  readonly workItems?: readonly WorkItemDetail[];
  readonly labels?: readonly Label[];
  readonly taskLabels?: readonly Label[];
  readonly labelUsage?: Readonly<Record<string, number>>;
  readonly assigneesByProject?: Readonly<Record<string, readonly User[]>>;
  readonly onClose: () => void;
  readonly onEdit: (task: WorkItemDetail) => void;
  readonly onOpenTask: (key: string) => void;
  readonly onCreateSubtask: (parentTask: WorkItemDetail) => void;
  readonly onSelectTask: (key: string) => void;
  readonly onRefresh: () => void;
  readonly isArchiving?: boolean;
  readonly isSyncing?: boolean;
}

interface DetailPanelState {
  readonly isLabelPickerOpen: boolean;
  readonly isMoveDialogOpen: boolean;
  readonly pendingProjectId: string;
  readonly setIsLabelPickerOpen: (isOpen: boolean) => void;
  readonly openMoveDialog: (projectId: string) => void;
  readonly closeMoveDialog: () => void;
}

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

function useDetailPanelState(): DetailPanelState {
  const [isLabelPickerOpen, setIsLabelPickerOpen] = useState(false);
  const [isMoveDialogOpen, setIsMoveDialogOpen] = useState(false);
  const [pendingProjectId, setPendingProjectId] = useState("");

  function openMoveDialog(projectId: string): void {
    setPendingProjectId(projectId);
    setIsMoveDialogOpen(true);
  }

  function closeMoveDialog(): void {
    setIsMoveDialogOpen(false);
    setPendingProjectId("");
  }

  return {
    closeMoveDialog,
    isLabelPickerOpen,
    isMoveDialogOpen,
    openMoveDialog,
    pendingProjectId,
    setIsLabelPickerOpen,
  };
}

function TaskPanelError(): React.ReactElement | null {
  const result = useActionData<typeof action>();
  const { t } = useTranslation();

  if (!result || result.ok) {
    return null;
  }

  return (
    <p
      className="mx-5 mt-4 rounded-lg bg-notice-subtle px-3 py-2 text-sm text-notice"
      role="alert"
    >
      {t(`tasks.error.${result.error}`)}
    </p>
  );
}

function DetailDialogs({
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

/** Renders the complete floating ticket panel with independent content panes. */
export function TaskDetailPanel({
  task,
  subtasks,
  checklist = [],
  links = [],
  attachments = [],
  descendants = null,
  statuses,
  assignees = [],
  milestones = [],
  projects = [],
  workItems = [],
  labels = [],
  taskLabels = [],
  labelUsage,
  assigneesByProject = {},
  onClose,
  onCreateSubtask,
  onEdit,
  onOpenTask,
  onSelectTask,
  onRefresh,
  isArchiving = false,
  isSyncing = false,
}: TaskDetailPanelProps): React.ReactElement {
  const actions = useTaskPanelActions(task);
  const dialogs = useDetailPanelState();

  return (
    <div className="flex h-full min-h-0 flex-col">
      <TaskPanelError />
      <DetailHeader
        descendants={descendants}
        isArchived={task.archivedAt !== null}
        isArchiving={isArchiving}
        onChangeStatus={actions.changeStatus}
        onClose={onClose}
        onEdit={onEdit}
        onSaveTitle={(title) => actions.update({ title })}
        onSelectTask={onSelectTask}
        statuses={statuses}
        task={task}
      />

      <DetailBody
        actions={actions}
        attachments={attachments}
        descendants={descendants}
        assignees={assignees}
        assigneesByProject={assigneesByProject}
        checklist={checklist}
        isArchiving={isArchiving}
        isSyncing={isSyncing}
        links={links}
        milestones={milestones}
        onCreateSubtask={onCreateSubtask}
        onEditLabels={() => dialogs.setIsLabelPickerOpen(true)}
        onOpenTask={onOpenTask}
        onRefresh={onRefresh}
        onChangeProject={dialogs.openMoveDialog}
        onSelectTask={onSelectTask}
        projects={projects}
        subtasks={subtasks}
        task={task}
        taskLabels={taskLabels}
        workItems={workItems}
      />

      <DetailDialogs
        assigneesByProject={assigneesByProject}
        isLabelPickerOpen={dialogs.isLabelPickerOpen}
        isMoveDialogOpen={dialogs.isMoveDialogOpen}
        isSyncing={isSyncing}
        labelUsage={labelUsage}
        milestones={milestones}
        onLabelPickerOpenChange={dialogs.setIsLabelPickerOpen}
        onMoveDialogClose={dialogs.closeMoveDialog}
        pendingProjectId={dialogs.pendingProjectId}
        labels={labels}
        projects={projects}
        task={task}
        taskLabels={taskLabels}
        workItems={workItems}
      />
    </div>
  );
}
