import { useRevalidator } from "react-router";

import { TicketAttachmentsSection } from "@/app/components/tasks/description/ticket-attachments-section";
import { TicketDescription } from "@/app/components/tasks/description/ticket-description";
import { useTicketUploads } from "@/app/components/tasks/description/use-ticket-uploads";
import { DetailChecklistSection } from "@/app/components/tasks/detail/detail-checklist-section";
import { DetailChildrenSection } from "@/app/components/tasks/detail/detail-children-section";
import { DetailKeyDetailsSection } from "@/app/components/tasks/detail/detail-key-details-section";
import { DetailLinksSection } from "@/app/components/tasks/detail/detail-links-section";
import { DetailPathSection } from "@/app/components/tasks/detail/detail-path-section";
import { DetailPropertiesSection } from "@/app/components/tasks/detail/detail-properties-section";
import { TicketLifecycleControls } from "@/app/components/tasks/ticket-lifecycle-controls";
import { useTicketAccess } from "@/app/components/tasks/ticket-access";
import { VerticalScrollArea } from "@/app/components/ui/vertical-scroll-area";
import { WORK_ITEM_TYPE } from "@/definition/Task";

import type { TaskPanelActions } from "@/app/components/tasks/detail/use-task-panel-actions";
import type { Project } from "@/definition/Project";
import type {
  Milestone,
  Label,
  WorkItemAttachment,
  WorkItemChecklistItem,
  WorkItemDescendants,
  WorkItemDetail,
  WorkItemLink,
} from "@/definition/Task";
import type { User } from "@/definition/User";

interface DetailMainColumnProps {
  readonly task: WorkItemDetail;
  readonly subtasks: readonly WorkItemDetail[];
  readonly checklist: readonly WorkItemChecklistItem[];
  readonly attachments: readonly WorkItemAttachment[];
  readonly isArchived: boolean;
  readonly isSyncing: boolean;
  readonly onCreateSubtask: (parentTask: WorkItemDetail) => void;
  readonly onOpenTask: (key: string) => void;
  readonly onSelectTask: (key: string) => void;
}

/** Renders description, attachments, checklist and children of a ticket. */
export function DetailMainColumn({
  task,
  subtasks,
  checklist,
  attachments,
  isArchived,
  isSyncing,
  onCreateSubtask,
  onOpenTask,
  onSelectTask,
}: DetailMainColumnProps): React.ReactElement {
  const revalidator = useRevalidator();
  const { canWrite } = useTicketAccess();
  const uploads = useTicketUploads(
    task.id,
    () => void revalidator.revalidate(),
  );
  const canEdit = canWrite && !isArchived;

  return (
    <VerticalScrollArea
      contentClassName="gap-3 pb-2"
      viewportClassName="pr-1 sm:pr-2"
    >
      <TicketDescription
        canEdit={canEdit}
        ticket={task}
        uploads={uploads}
        variant="panel"
      />
      <TicketAttachmentsSection
        attachments={attachments}
        canEdit={canEdit}
        uploads={uploads}
      />
      <DetailChecklistSection
        isArchived={isArchived}
        isSubmitting={isSyncing}
        items={checklist}
        workItemId={task.id}
      />
      {task.type !== WORK_ITEM_TYPE.SUBTASK ? (
        <DetailChildrenSection
          isArchived={isArchived}
          onCreateSubtask={onCreateSubtask}
          onOpenTask={onOpenTask}
          onSelectTask={onSelectTask}
          subtasks={subtasks}
          task={task}
        />
      ) : null}
    </VerticalScrollArea>
  );
}

interface DetailSideColumnProps {
  readonly task: WorkItemDetail;
  readonly actions: TaskPanelActions;
  readonly taskLabels: readonly Label[];
  readonly assignees: readonly User[];
  readonly reporters: readonly User[];
  readonly projects: readonly Project[];
  readonly milestones: readonly Milestone[];
  readonly workItems: readonly WorkItemDetail[];
  readonly links: readonly WorkItemLink[];
  readonly descendants: WorkItemDescendants | null;
  readonly isArchived: boolean;
  readonly isArchiving: boolean;
  readonly isSyncing: boolean;
  readonly onChangeProject: (projectId: string) => void;
  readonly onEditLabels: () => void;
  readonly onSelectTask: (key: string) => void;
}

/** Renders key details, properties, path, links and the archive button. */
export function DetailSideColumn({
  task,
  actions,
  taskLabels,
  assignees,
  reporters,
  projects,
  milestones,
  workItems,
  links,
  descendants,
  isArchived,
  isArchiving,
  isSyncing,
  onChangeProject,
  onEditLabels,
  onSelectTask,
}: DetailSideColumnProps): React.ReactElement {
  return (
    <VerticalScrollArea
      contentClassName="gap-3 pb-2 text-xs"
      viewportClassName="pr-1 sm:pr-2"
    >
      <DetailKeyDetailsSection
        isArchived={isArchived}
        onChangePriority={(priority) => actions.update({ priority })}
        onEditLabels={onEditLabels}
        onRemoveLabel={actions.removeLabel}
        task={task}
        taskLabels={taskLabels}
      />
      <DetailPropertiesSection
        actions={actions}
        assignees={assignees}
        isArchived={isArchived}
        isSyncing={isSyncing}
        milestones={milestones}
        onChangeProject={onChangeProject}
        projects={projects}
        reporters={reporters}
        task={task}
      />
      <DetailPathSection
        isArchived={isArchived}
        onSelectTask={onSelectTask}
        task={task}
        workItems={workItems}
      />
      <DetailLinksSection
        isArchived={isArchived}
        isSyncing={isSyncing}
        links={links}
        onSelectTask={onSelectTask}
        task={task}
        workItems={workItems}
      />
      <TicketLifecycleControls
        descendants={descendants}
        isArchiving={isArchiving}
        ticket={task}
      />
    </VerticalScrollArea>
  );
}
