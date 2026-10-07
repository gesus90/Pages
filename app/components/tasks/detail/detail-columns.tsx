import { DetailChecklistSection } from "@/app/components/tasks/detail/detail-checklist-section";
import { DetailChildrenSection } from "@/app/components/tasks/detail/detail-children-section";
import { DetailDescriptionSection } from "@/app/components/tasks/detail/detail-description-section";
import { DetailKeyDetailsSection } from "@/app/components/tasks/detail/detail-key-details-section";
import { DetailLinksSection } from "@/app/components/tasks/detail/detail-links-section";
import { DetailPathSection } from "@/app/components/tasks/detail/detail-path-section";
import { DetailPropertiesSection } from "@/app/components/tasks/detail/detail-properties-section";
import { TicketLifecycleControls } from "@/app/components/tasks/ticket-lifecycle-controls";
import { VerticalScrollArea } from "@/app/components/ui/vertical-scroll-area";
import { WORK_ITEM_TYPE } from "@/definition/Task";

import type { TaskPanelActions } from "@/app/components/tasks/detail/use-task-panel-actions";
import type { Project } from "@/definition/Project";
import type {
  Milestone,
  Label,
  WorkItemChecklistItem,
  WorkItemDetail,
  WorkItemLink,
} from "@/definition/Task";
import type { User } from "@/definition/User";

interface DetailMainColumnProps {
  readonly task: WorkItemDetail;
  readonly subtasks: readonly WorkItemDetail[];
  readonly checklist: readonly WorkItemChecklistItem[];
  readonly actions: TaskPanelActions;
  readonly isArchived: boolean;
  readonly isSyncing: boolean;
  readonly onCreateSubtask: (parentTask: WorkItemDetail) => void;
  readonly onOpenTask: (key: string) => void;
  readonly onSelectTask: (key: string) => void;
}

/** Renders description, checklist and subtasks of a ticket. */
export function DetailMainColumn({
  task,
  subtasks,
  checklist,
  actions,
  isArchived,
  isSyncing,
  onCreateSubtask,
  onOpenTask,
  onSelectTask,
}: DetailMainColumnProps): React.ReactElement {
  return (
    <VerticalScrollArea
      contentClassName="gap-3 pb-2"
      viewportClassName="pr-1 sm:pr-2"
    >
      <DetailDescriptionSection
        description={task.description}
        isArchived={isArchived}
        onSave={(description) => actions.update({ description })}
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
        onChangeParent={(parentId) => actions.update({ parentId })}
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
      <TicketLifecycleControls isArchiving={isArchiving} ticket={task} />
    </VerticalScrollArea>
  );
}
