import { Calendar, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useAssigneeOptions } from "@/app/components/tasks/assignee-options";
import { TaskGitHubDetails } from "@/app/components/tasks/task-github-details";
import { TaskTypeBadge } from "@/app/components/tasks/task-badges";
import { TaskLabelPill } from "@/app/components/tasks/task-labels";
import { TicketDepartmentSelect } from "@/app/components/tasks/ticket-department-select";
import { TicketLifecycleControls } from "@/app/components/tasks/ticket-lifecycle-controls";
import { usePriorityOptions } from "@/app/components/tasks/priority-options";
import { Select } from "@/app/components/ui/select";
import { toAssigneeValue } from "@/app/lib/assignee-value";
import { WORK_ITEM_TYPE } from "@/definition/Task";

import type { TaskPanelActions } from "@/app/components/tasks/detail/use-task-panel-actions";
import type { GitHubPullRequest } from "@/definition/GitHub";
import type { Project } from "@/definition/Project";
import type {
  Milestone,
  Label,
  WorkItemDetail,
  WorkflowStatus,
} from "@/definition/Task";
import type { User } from "@/definition/User";

const PARENT_LABEL_KEYS: Readonly<Record<WorkItemDetail["type"], string>> = {
  [WORK_ITEM_TYPE.INITIATIVE]: "tasks.fields.parentEpic",
  [WORK_ITEM_TYPE.EPIC]: "tasks.fields.parentInitiative",
  [WORK_ITEM_TYPE.TASK]: "tasks.fields.parentEpic",
  [WORK_ITEM_TYPE.SUBTASK]: "tasks.fields.parentTask",
};

interface RowProps {
  readonly label: string;
  readonly labelId?: string;
  readonly children: React.ReactNode;
}

/** Renders one labelled row of the ticket sidebar. */
function Row({ label, labelId, children }: RowProps): React.ReactElement {
  return (
    <div className="flex items-center justify-between gap-2">
      <span
        className="select-none font-medium text-muted-foreground"
        id={labelId}
      >
        {label}
      </span>
      {children}
    </div>
  );
}

interface DateRowProps {
  readonly label: string;
  readonly inputId: string;
  readonly value: string | null;
  readonly isArchived: boolean;
  readonly onChange: (value: string) => void;
}

/** Renders a date row with a calendar icon and a native date input. */
function DateRow({
  label,
  inputId,
  value,
  isArchived,
  onChange,
}: DateRowProps): React.ReactElement {
  return (
    <div className="flex items-center justify-between gap-2">
      <label
        className="select-none font-medium text-muted-foreground"
        htmlFor={inputId}
      >
        {label}
      </label>
      <span className="inline-flex max-w-40 items-center gap-1.5">
        <Calendar
          className="size-3.5 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <input
          id={inputId}
          type="date"
          className="h-8 w-full rounded-lg bg-surface px-2 font-medium text-foreground shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"
          disabled={isArchived}
          value={value ?? ""}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
      </span>
    </div>
  );
}

interface ParentSelectRowProps {
  readonly label: string;
  readonly labelId: string;
  readonly ticket: WorkItemDetail;
  readonly options: readonly WorkItemDetail[];
  readonly isArchived: boolean;
  readonly onChange: (parentId: string) => void;
}

/** Renders a select that assigns the parent initiative or epic. */
function ParentSelectRow({
  label,
  labelId,
  ticket,
  options,
  isArchived,
  onChange,
}: ParentSelectRowProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <Row label={label} labelId={labelId}>
      <Select
        ariaLabel={label}
        value={ticket.parentId ?? ""}
        onValueChange={onChange}
        disabled={isArchived}
        options={[
          { value: "", label: t("tasks.none") },
          ...options.map((option) => ({
            value: option.id,
            label: `${option.key}: ${option.title}`,
          })),
        ]}
      />
    </Row>
  );
}

interface SidebarProps {
  readonly ticket: WorkItemDetail;
  readonly actions: TaskPanelActions;
  readonly isArchived: boolean;
}

interface PeopleRowsProps extends SidebarProps {
  readonly statuses: readonly WorkflowStatus[];
  readonly assignees: readonly User[];
}

/** Renders type, status, priority, assignee and reporter of a ticket. */
function PeopleRows({
  ticket,
  actions,
  isArchived,
  statuses,
  assignees,
}: PeopleRowsProps): React.ReactElement {
  const { t } = useTranslation();
  const priorityOptions = usePriorityOptions();
  const assigneeOptions = useAssigneeOptions(assignees, {
    currentGroupId: ticket.assigneeGroupId,
    projectId: ticket.projectId,
  });

  return (
    <>
      <Row label={t("tasks.fields.type")}>
        <TaskTypeBadge type={ticket.type} />
      </Row>
      <Row label={t("tasks.fields.status")} labelId="detail-status">
        <Select
          ariaLabel={t("tasks.fields.status")}
          value={ticket.statusId}
          onValueChange={actions.changeStatus}
          disabled={isArchived}
          options={statuses.map((status) => ({
            value: status.id,
            label: status.name,
          }))}
        />
      </Row>
      <Row label={t("tasks.fields.priority")} labelId="detail-priority">
        <Select
          ariaLabel={t("tasks.fields.priority")}
          value={ticket.priority}
          onValueChange={(priority) => actions.update({ priority })}
          disabled={isArchived}
          options={priorityOptions}
        />
      </Row>
      <Row label={t("tasks.fields.assignee")} labelId="detail-assignee">
        <Select
          ariaLabel={t("tasks.fields.assignee")}
          value={toAssigneeValue(ticket)}
          onValueChange={(assignee) => actions.update({ assignee })}
          disabled={isArchived}
          options={assigneeOptions}
        />
      </Row>
      <Row label={t("tasks.fields.reporter")} labelId="detail-reporter">
        <Select
          ariaLabel={t("tasks.fields.reporter")}
          value={ticket.createdBy}
          onValueChange={(reporterId) => actions.update({ reporterId })}
          disabled={isArchived}
          options={assignees.map((assignee) => ({
            value: assignee.id,
            label: assignee.displayName,
          }))}
        />
      </Row>
    </>
  );
}

interface PlacementRowsProps extends SidebarProps {
  readonly project: Project;
  readonly parent: WorkItemDetail | null;
  readonly milestones: readonly Milestone[];
  readonly taskLabels: readonly Label[];
  readonly epicOptions: readonly WorkItemDetail[];
  readonly initiativeOptions: readonly WorkItemDetail[];
  readonly onOpenTicket: (key: string) => void;
  readonly onMoveProject: () => void;
  readonly onEditLabels: () => void;
}

/** Renders project, parent, milestone and labels of a ticket. */
function PlacementRows({
  ticket,
  actions,
  isArchived,
  project,
  parent,
  milestones,
  taskLabels,
  epicOptions,
  initiativeOptions,
  onOpenTicket,
  onMoveProject,
  onEditLabels,
}: PlacementRowsProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <>
      <Row label={t("tasks.fields.project")}>
        <span className="inline-flex items-center gap-2 font-medium text-foreground">
          {project.name}
          {!isArchived ? (
            <button
              className="font-semibold text-primary hover:underline"
              onClick={onMoveProject}
              type="button"
            >
              {t("tasks.move.open")}
            </button>
          ) : null}
        </span>
      </Row>
      <Row label={t("tasks.fields.department")}>
        <TicketDepartmentSelect ticket={ticket} />
      </Row>
      {parent ? (
        <Row label={t(PARENT_LABEL_KEYS[ticket.type])}>
          <button
            className="font-semibold text-primary hover:underline"
            onClick={() => onOpenTicket(parent.key)}
            type="button"
          >
            {parent.key}
          </button>
        </Row>
      ) : null}
      {ticket.type === WORK_ITEM_TYPE.TASK ? (
        <ParentSelectRow
          isArchived={isArchived}
          label={t("tasks.fields.parentEpic")}
          labelId="detail-epic"
          onChange={(parentId) => actions.update({ parentId })}
          options={epicOptions}
          ticket={ticket}
        />
      ) : null}
      {ticket.type === WORK_ITEM_TYPE.EPIC ? (
        <ParentSelectRow
          isArchived={isArchived}
          label={t("tasks.fields.parentInitiative")}
          labelId="detail-initiative"
          onChange={(parentId) => actions.update({ parentId })}
          options={initiativeOptions}
          ticket={ticket}
        />
      ) : null}
      <Row label={t("tasks.fields.milestone")} labelId="detail-milestone">
        <Select
          ariaLabel={t("tasks.fields.milestone")}
          value={ticket.milestoneId ?? ""}
          onValueChange={(milestoneId) => actions.update({ milestoneId })}
          disabled={isArchived}
          options={[
            { value: "", label: t("tasks.none") },
            ...milestones.map((milestone) => ({
              value: milestone.id,
              label: milestone.name,
            })),
          ]}
        />
      </Row>
      <Row label={t("tasks.fields.labels")} labelId="detail-labels">
        <span className="inline-flex max-w-48 flex-wrap items-center justify-end gap-1">
          {taskLabels.map((label) => (
            <TaskLabelPill key={label.id} label={label} />
          ))}
          {!isArchived ? (
            <button
              aria-label={t("tasks.labels.editLabels")}
              className="inline-flex size-6 items-center justify-center rounded-lg bg-surface text-muted-foreground shadow-xs hover:bg-surface-hover hover:text-foreground"
              onClick={onEditLabels}
              type="button"
            >
              <Plus className="size-3.5" aria-hidden="true" />
            </button>
          ) : null}
        </span>
      </Row>
    </>
  );
}

/** Renders start date, due date and the progress bar of a ticket. */
function ScheduleRows({
  ticket,
  actions,
  isArchived,
}: SidebarProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <>
      <DateRow
        inputId="detail-start"
        isArchived={isArchived}
        label={t("tasks.fields.startAt")}
        onChange={(startAt) => actions.update({ startAt })}
        value={ticket.startAt}
      />
      <DateRow
        inputId="detail-due"
        isArchived={isArchived}
        label={t("tasks.fields.dueAt")}
        onChange={(dueAt) => actions.update({ dueAt })}
        value={ticket.dueAt}
      />
      <div className="mt-1 pt-3">
        <div className="flex items-center justify-between font-medium">
          <span className="text-muted-foreground">{t("tasks.progress")}</span>
          <span className="text-foreground">
            {ticket.subtaskTotal > 0
              ? `${ticket.subtaskCompleted} / ${ticket.subtaskTotal} (${ticket.progressPercentage} %)`
              : `${ticket.progressPercentage} %`}
          </span>
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all duration-300"
            style={{ width: `${ticket.progressPercentage}%` }}
          />
        </div>
      </div>
    </>
  );
}

interface TicketSidebarProps extends PeopleRowsProps, PlacementRowsProps {
  readonly pullRequests: readonly GitHubPullRequest[];
  /** Whether new tasks of the project reach GitHub without further action. */
  readonly publishesNewTasks: boolean;
  readonly isArchiving: boolean;
  readonly isSyncing: boolean;
  readonly redirectTo: string;
}

/** Renders the fields, progress, GitHub details and lifecycle controls of a ticket. */
export function TicketSidebar(props: TicketSidebarProps): React.ReactElement {
  const { ticket, isArchived } = props;

  return (
    <aside className="flex min-w-0 flex-col gap-3 text-xs">
      <div className="flex flex-col gap-3 rounded-xl bg-muted/40 p-4">
        <PeopleRows {...props} />
        <PlacementRows {...props} />
        <ScheduleRows
          actions={props.actions}
          isArchived={isArchived}
          ticket={ticket}
        />
      </div>

      <TaskGitHubDetails
        isSyncing={props.isSyncing}
        publishesNewTasks={props.publishesNewTasks}
        pullRequests={props.pullRequests}
        task={ticket}
      />

      <TicketLifecycleControls
        isArchiving={props.isArchiving}
        redirectTo={props.redirectTo}
        ticket={ticket}
      />
    </aside>
  );
}
