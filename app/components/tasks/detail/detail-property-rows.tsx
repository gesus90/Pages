import {
  Calendar,
  Folder,
  Milestone as MilestoneIcon,
  User as UserIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { useAssigneeOptions } from "@/app/components/tasks/assignee-options";
import { GitHubSyncBadge } from "@/app/components/tasks/github-sync-badge";
import { TicketDepartmentSelect } from "@/app/components/tasks/ticket-department-select";
import { Select } from "@/app/components/ui/select";
import { toAssigneeValue } from "@/app/lib/assignee-value";

import type { Milestone } from "@/definition/Task";
import type { Project } from "@/definition/Project";
import type { WorkItemDetail } from "@/definition/Task";
import type { User } from "@/definition/User";

interface RowProps {
  readonly task: WorkItemDetail;
  readonly isArchived: boolean;
}

interface PeopleRowsProps extends RowProps {
  readonly assignees: readonly User[];
  readonly reporters: readonly User[];
  readonly onChangeAssignee: (assignee: string) => void;
  readonly onChangeReporter: (reporterId: string) => void;
}

/** Renders the assignee and reporter rows of the ticket details. */
export function PeopleRows({
  task,
  isArchived,
  assignees: projectAssignees,
  reporters: reporterOptions,
  onChangeAssignee: handleAssigneeChange,
  onChangeReporter: handleReporterChange,
}: PeopleRowsProps): React.ReactElement {
  const { t } = useTranslation();
  const assigneeOptions = useAssigneeOptions(projectAssignees, {
    currentGroupId: task.assigneeGroupId,
    projectId: task.projectId,
  });

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <dt className="text-muted-foreground">{t("tasks.fields.assignee")}</dt>
        <dd className="flex min-w-0 items-center gap-1.5">
          <UserIcon
            className="size-3.5 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <Select
            ariaLabel={t("tasks.fields.assignee")}
            className="min-w-0"
            disabled={isArchived}
            onValueChange={handleAssigneeChange}
            options={assigneeOptions}
            value={toAssigneeValue(task)}
          />
        </dd>
      </div>
      <div className="flex items-center justify-between gap-3">
        <dt className="text-muted-foreground">{t("tasks.fields.reporter")}</dt>
        <dd>
          <Select
            ariaLabel={t("tasks.fields.reporter")}
            disabled={isArchived}
            onValueChange={handleReporterChange}
            options={reporterOptions.map((reporter) => ({
              label: reporter.displayName,
              value: reporter.id,
            }))}
            value={task.createdBy}
          />
        </dd>
      </div>
    </>
  );
}

interface PlacementRowsProps extends RowProps {
  readonly projects: readonly Project[];
  readonly milestones: readonly Milestone[];
  readonly onChangeProject: (projectId: string) => void;
  readonly onChangeMilestone: (milestoneId: string) => void;
}

/** Renders the project and milestone rows of the ticket details. */
export function PlacementRows({
  task,
  isArchived,
  projects,
  milestones: availableMilestones,
  onChangeProject: handleProjectChange,
  onChangeMilestone: handleMilestoneChange,
}: PlacementRowsProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <dt className="text-muted-foreground">{t("tasks.fields.project")}</dt>
        <dd className="flex min-w-0 items-center gap-1.5">
          <Folder
            className="size-3.5 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <Select
            ariaLabel={t("tasks.fields.project")}
            className="min-w-0"
            disabled={isArchived || projects.length === 0}
            onValueChange={handleProjectChange}
            options={
              projects.length === 0
                ? [
                    {
                      label: task.projectName,
                      value: task.projectId,
                    },
                  ]
                : projects.map((project) => ({
                    label: project.name,
                    value: project.id,
                  }))
            }
            value={task.projectId}
          />
        </dd>
      </div>
      <div className="flex items-center justify-between gap-3">
        <dt className="text-muted-foreground">
          {t("tasks.fields.department")}
        </dt>
        <dd className="flex min-w-0 items-center gap-1.5">
          <TicketDepartmentSelect ticket={task} />
        </dd>
      </div>
      <div className="flex items-center justify-between gap-3">
        <dt className="text-muted-foreground">{t("tasks.fields.milestone")}</dt>
        <dd className="flex min-w-0 items-center gap-1.5">
          <MilestoneIcon
            className="size-3.5 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <Select
            ariaLabel={t("tasks.fields.milestone")}
            className="min-w-0"
            disabled={isArchived}
            onValueChange={handleMilestoneChange}
            options={[
              { label: t("tasks.none"), value: "" },
              ...availableMilestones.map((milestone) => ({
                label: milestone.name,
                value: milestone.id,
              })),
            ]}
            value={task.milestoneId ?? ""}
          />
        </dd>
      </div>
    </>
  );
}

interface StatusRowsProps {
  readonly task: WorkItemDetail;
  readonly isSyncing: boolean;
}

/** Renders progress, synchronization state and timestamps of the ticket. */
export function StatusRows({
  task,
  isSyncing,
}: StatusRowsProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between text-xs font-medium">
          <span className="text-muted-foreground">{t("tasks.progress")}</span>
          <span className="text-foreground">
            {task.subtaskTotal > 0
              ? `${task.subtaskCompleted} / ${task.subtaskTotal} (${task.progressPercentage} %)`
              : `${task.progressPercentage} %`}
          </span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all duration-300"
            style={{ width: `${task.progressPercentage}%` }}
          />
        </div>
      </div>
      <div className="flex items-center justify-between gap-3">
        <dt className="text-muted-foreground">{t("tasks.detail.gitStatus")}</dt>
        <dd>
          <GitHubSyncBadge
            githubConflict={task.githubConflict}
            githubIssueNumber={task.githubIssueNumber}
            githubLastError={task.githubLastError}
            githubLastSyncAt={task.githubLastSyncAt}
            isSyncing={isSyncing}
            updatedAt={task.updatedAt}
          />
        </dd>
      </div>
      <div className="flex items-center justify-between gap-3">
        <dt className="text-muted-foreground">{t("tasks.detail.createdAt")}</dt>
        <dd className="font-medium text-foreground">{task.createdAt}</dd>
      </div>
      <div className="flex items-center justify-between gap-3">
        <dt className="text-muted-foreground">{t("tasks.detail.updatedAt")}</dt>
        <dd className="font-medium text-foreground">{task.updatedAt}</dd>
      </div>
    </>
  );
}

interface DateRowsProps extends RowProps {
  readonly onChangeStartAt: (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => void;
  readonly onChangeDueAt: (event: React.ChangeEvent<HTMLInputElement>) => void;
}

/** Renders the start and due date rows of the ticket details. */
export function DateRows({
  task,
  isArchived,
  onChangeStartAt: handleStartAtChange,
  onChangeDueAt: handleDueAtChange,
}: DateRowsProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <dt>
          <label
            className="text-muted-foreground"
            htmlFor={`task-start-${task.id}`}
          >
            {t("tasks.fields.startAt")}
          </label>
        </dt>
        <dd className="flex min-w-0 items-center gap-1.5">
          <Calendar
            className="size-3.5 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            id={`task-start-${task.id}`}
            className="h-8 min-w-0 rounded-lg bg-muted/60 px-2 font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"
            disabled={isArchived}
            onChange={handleStartAtChange}
            type="date"
            value={task.startAt ?? ""}
          />
        </dd>
      </div>
      <div className="flex items-center justify-between gap-3">
        <dt>
          <label
            className="text-muted-foreground"
            htmlFor={`task-due-${task.id}`}
          >
            {t("tasks.fields.dueAt")}
          </label>
        </dt>
        <dd className="flex min-w-0 items-center gap-1.5">
          <Calendar
            className="size-3.5 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            id={`task-due-${task.id}`}
            className="h-8 min-w-0 rounded-lg bg-muted/60 px-2 font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"
            disabled={isArchived}
            onChange={handleDueAtChange}
            type="date"
            value={task.dueAt ?? ""}
          />
        </dd>
      </div>
    </>
  );
}
