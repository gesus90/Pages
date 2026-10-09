import { DetailBody } from "@/app/components/tasks/detail/detail-body";
import { DetailDialogs } from "@/app/components/tasks/detail/detail-dialogs";
import { DetailHeader } from "@/app/components/tasks/detail/detail-header";
import { useDetailPanelState } from "@/app/components/tasks/detail/use-detail-panel-state";
import { useTaskPanelActions } from "@/app/components/tasks/detail/use-task-panel-actions";
import { FloatingPanel } from "@/app/components/ui/card";
import { cn } from "@/app/lib/cn";

import styles from "./task-detail-panel.module.css";

import type { GitHubPullRequest } from "@/definition/GitHub";
import type { Project } from "@/definition/Project";
import type {
  Milestone,
  Label,
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
  readonly isArchiving?: boolean;
  readonly isSyncing?: boolean;
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
  isArchiving = false,
  isSyncing = false,
}: TaskDetailPanelProps): React.ReactElement {
  const actions = useTaskPanelActions(task);
  const dialogs = useDetailPanelState(onClose);

  return (
    <>
      <div aria-hidden="true" className={styles.backdrop} />
      <div className={styles.positioner}>
        <FloatingPanel
          aria-label={`${task.key} ${task.title}`}
          aria-modal="false"
          className={cn(
            styles.panel,
            "pointer-events-auto h-full max-h-none w-full overflow-hidden p-0",
          )}
          role="dialog"
        >
          <DetailHeader
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
        </FloatingPanel>
      </div>
    </>
  );
}
