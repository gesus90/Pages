import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";

import { TicketAttachmentsSection } from "@/app/components/tasks/description/ticket-attachments-section";
import { TicketDescription } from "@/app/components/tasks/description/ticket-description";
import { useTicketUploads } from "@/app/components/tasks/description/use-ticket-uploads";
import { DetailSection } from "@/app/components/tasks/detail-section";
import { DetailChecklistSection } from "@/app/components/tasks/detail/detail-checklist-section";
import { DetailChildrenSection } from "@/app/components/tasks/detail/detail-children-section";
import { DetailLinksSection } from "@/app/components/tasks/detail/detail-links-section";
import { DetailPathSection } from "@/app/components/tasks/detail/detail-path-section";
import {
  DateRows,
  PeopleRows,
  PlacementRows,
  StatusRows,
} from "@/app/components/tasks/detail/detail-property-rows";
import { TaskLabelPill } from "@/app/components/tasks/task-labels";
import { useTicketAccess } from "@/app/components/tasks/ticket-access";
import { TicketLifecycleControls } from "@/app/components/tasks/ticket-lifecycle-controls";
import { Select } from "@/app/components/ui/select";
import { VerticalScrollArea } from "@/app/components/ui/vertical-scroll-area";
import { WORK_ITEM_PRIORITY, WORK_ITEM_TYPE } from "@/definition/Task";

import type { TaskPanelActions } from "@/app/components/tasks/detail/use-task-panel-actions";
import type { Project } from "@/definition/Project";
import type {
  Label,
  Milestone,
  WorkItemAttachment,
  WorkItemChecklistItem,
  WorkItemDescendants,
  WorkItemDetail,
  WorkItemLink,
  WorkItemPriority,
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
  readonly onRefresh: () => void;
}

interface DetailKeyDetailsSectionProps {
  readonly task: WorkItemDetail;
  readonly taskLabels: readonly Label[];
  readonly isArchived: boolean;
  readonly onChangePriority: (priority: WorkItemPriority) => void;
  readonly onRemoveLabel: (label: Label) => void;
  readonly onEditLabels: () => void;
}

interface DetailPropertiesSectionProps {
  readonly task: WorkItemDetail;
  readonly actions: TaskPanelActions;
  readonly assignees: readonly User[];
  readonly reporters: readonly User[];
  readonly projects: readonly Project[];
  readonly milestones: readonly Milestone[];
  readonly isArchived: boolean;
  readonly isSyncing: boolean;
  readonly onChangeProject: (projectId: string) => void;
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

function DetailKeyDetailsSection({
  task,
  taskLabels,
  isArchived,
  onChangePriority,
  onRemoveLabel,
  onEditLabels,
}: DetailKeyDetailsSectionProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <DetailSection title={t("tasks.detail.keyDetails")}>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
        <dt className="text-muted-foreground">{t("tasks.fields.priority")}</dt>
        <dt className="text-muted-foreground">{t("tasks.fields.labels")}</dt>
        <dd className="min-w-0">
          <Select
            ariaLabel={t("tasks.fields.priority")}
            className="w-full min-w-0"
            disabled={isArchived}
            onValueChange={onChangePriority}
            options={[
              {
                label: t("tasks.priority.low"),
                value: WORK_ITEM_PRIORITY.LOW,
              },
              {
                label: t("tasks.priority.normal"),
                value: WORK_ITEM_PRIORITY.NORMAL,
              },
              {
                label: t("tasks.priority.high"),
                value: WORK_ITEM_PRIORITY.HIGH,
              },
              {
                label: t("tasks.priority.urgent"),
                value: WORK_ITEM_PRIORITY.URGENT,
              },
            ]}
            value={task.priority}
          />
        </dd>
        <dd className="flex min-w-0 flex-wrap items-center gap-1">
          {taskLabels.map((label) => (
            <TaskLabelPill
              key={label.id}
              label={label}
              onRemove={isArchived ? undefined : () => onRemoveLabel(label)}
            />
          ))}
          <button
            aria-label={t("tasks.labels.editLabels")}
            className="inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60"
            disabled={isArchived}
            onClick={onEditLabels}
            type="button"
          >
            <Plus className="size-3.5" aria-hidden="true" />
          </button>
        </dd>
      </dl>
    </DetailSection>
  );
}

function DetailPropertiesSection({
  task,
  actions,
  assignees,
  reporters,
  projects,
  milestones,
  isArchived,
  isSyncing,
  onChangeProject,
}: DetailPropertiesSectionProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <DetailSection title={t("tasks.detail.details")}>
      <dl className="flex flex-col gap-3">
        <PeopleRows
          assignees={assignees}
          isArchived={isArchived}
          onChangeAssignee={(assignee) => actions.update({ assignee })}
          onChangeReporter={(reporterId) => actions.update({ reporterId })}
          reporters={reporters}
          task={task}
        />
        <PlacementRows
          isArchived={isArchived}
          milestones={milestones}
          onChangeMilestone={(milestoneId) => actions.update({ milestoneId })}
          onChangeProject={onChangeProject}
          projects={projects}
          task={task}
        />
        <StatusRows isSyncing={isSyncing} task={task} />
        <DateRows
          isArchived={isArchived}
          onChangeDueAt={(event) =>
            actions.update({ dueAt: event.currentTarget.value })
          }
          onChangeStartAt={(event) =>
            actions.update({ startAt: event.currentTarget.value })
          }
          task={task}
        />
      </dl>
    </DetailSection>
  );
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
  onRefresh,
}: DetailMainColumnProps): React.ReactElement {
  const { canWrite } = useTicketAccess();
  const uploads = useTicketUploads(task.id, onRefresh);
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
