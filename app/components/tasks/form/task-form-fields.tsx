import { useTranslation } from "react-i18next";

import { AssigneeSightNotice } from "@/app/components/tasks/assignee-sight-notice";
import { useAssigneeOptions } from "@/app/components/tasks/assignee-options";
import { useAssigneeSight } from "@/app/components/tasks/use-assignee-sight";
import { useTicketAccess } from "@/app/components/tasks/ticket-access";
import { TicketDepartmentChips } from "@/app/components/tasks/ticket-department-chips";
import { WORK_ITEM_LIMITS } from "@/definition/Task";

import { TaskFormTemplateField } from "./task-form-template-field";
import { TaskFormSelectField } from "./task-form-select-field";
import { TaskFormTextField } from "./task-form-text-field";
import {
  PARENT_FIELDS,
  parentOptions,
  priorityOptions,
  reporterOptions,
  workItemTypeOptions,
} from "./task-form-options";

import type { Project } from "@/definition/Project";
import type {
  Milestone,
  WorkItemDetail,
  WorkflowStatus,
} from "@/definition/Task";
import type { User } from "@/definition/User";
import type {
  WorkItemTemplate,
  WorkItemTemplateView,
} from "@/definition/WorkItemTemplate";
import type {
  TaskFormSelectionState,
  TaskFormSelections,
} from "./task-form-selections";

/** Everything the form fields offer to pick from. */
interface TaskFormChoices {
  readonly projects: readonly Project[];
  readonly statuses: readonly WorkflowStatus[];
  readonly milestones: readonly Milestone[];
  readonly assignees: readonly User[];
  readonly existingWorkItems: readonly WorkItemDetail[];
  readonly templates: readonly WorkItemTemplateView[];
}

interface TaskFormFieldsProps extends TaskFormChoices, TaskFormSelectionState {
  readonly mode: "create" | "edit";
  readonly initialTask: WorkItemDetail | null;
}

type SectionProps = Pick<
  TaskFormFieldsProps,
  "mode" | "initialTask" | "select" | "selections"
> &
  TaskFormChoices;

function ClassificationFields({
  mode,
  initialTask,
  projects,
  existingWorkItems,
  select,
  selections,
}: SectionProps): React.ReactElement {
  const { t } = useTranslation();
  const parentField = PARENT_FIELDS[selections.type];

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <TaskFormSelectField
          id="task-type"
          label={t("tasks.fields.type")}
          value={selections.type}
          onValueChange={(value) => select("type", value)}
          isDisabled={mode === "edit"}
          options={workItemTypeOptions(t)}
        />
        <TaskFormSelectField
          id="task-project"
          label={t("tasks.fields.project")}
          value={selections.projectId}
          onValueChange={(value) => select("projectId", value)}
          isDisabled={mode === "edit"}
          options={projects.map((project) => ({
            value: project.id,
            label: project.name,
          }))}
        />
      </div>

      {parentField ? (
        <TaskFormSelectField
          id={parentField.id}
          label={t(parentField.labelKey)}
          value={selections.parentId}
          onValueChange={(value) => select("parentId", value)}
          options={parentOptions(
            {
              editedItemId: initialTask?.id,
              existingWorkItems,
              field: parentField,
              projectId: selections.projectId,
            },
            t("tasks.none"),
          )}
        />
      ) : null}
    </>
  );
}

function TextFields({
  initialTask,
  template,
}: Pick<SectionProps, "initialTask"> & {
  readonly template: WorkItemTemplate | null;
}): React.ReactElement {
  const { t } = useTranslation();
  // A new key starts the uncontrolled fields over with the chosen template's text.
  const fieldKey = template?.id ?? "none";

  return (
    <>
      <TaskFormTextField
        key={`title-${fieldKey}`}
        defaultValue={initialTask?.title ?? template?.title ?? ""}
        id="task-title"
        isRequired
        label={t("tasks.fields.title")}
        maxLength={200}
        name="title"
      />
      <TaskFormTextField
        key={`description-${fieldKey}`}
        defaultValue={initialTask?.description ?? template?.description ?? ""}
        hint={t("tasks.descriptionHint")}
        id="task-description"
        label={t("tasks.fields.description")}
        maxLength={WORK_ITEM_LIMITS.descriptionLength}
        name="description"
        type="textarea"
      />
    </>
  );
}

function WorkflowFields({
  statuses,
  select,
  selections,
}: Pick<
  SectionProps,
  "statuses" | "select" | "selections"
>): React.ReactElement {
  const { t } = useTranslation();

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <TaskFormSelectField
        id="task-status"
        label={t("tasks.fields.status")}
        value={selections.statusId}
        onValueChange={(value) => select("statusId", value)}
        options={statuses.map((status) => ({
          value: status.id,
          label: status.name,
        }))}
      />
      <TaskFormSelectField
        id="task-priority"
        label={t("tasks.fields.priority")}
        value={selections.priority}
        onValueChange={(value) => select("priority", value)}
        options={priorityOptions(t)}
      />
    </div>
  );
}

function milestoneOptions(
  milestones: readonly Milestone[],
  selections: TaskFormSelections,
  noneLabel: string,
): { value: string; label: string }[] {
  return [
    { value: "", label: noneLabel },
    ...milestones
      .filter((milestone) => milestone.projectId === selections.projectId)
      .map((milestone) => ({ value: milestone.id, label: milestone.name })),
  ];
}

function PeopleAndDateFields({
  mode,
  initialTask,
  assignees,
  milestones,
  select,
  selections,
}: SectionProps): React.ReactElement {
  const { t } = useTranslation();
  const { departments, knownDepartments } = useTicketAccess();
  const assigneeOptions = useAssigneeOptions(assignees, {
    currentGroupId: initialTask?.assigneeGroupId ?? null,
    projectId: selections.projectId,
  });
  const { check, dismiss, warning } = useAssigneeSight(
    initialTask
      ? { ticketId: initialTask.id }
      : { departmentIds: selections.departmentIds },
  );

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <TaskFormSelectField
          id="task-assignee"
          label={t("tasks.fields.assignee")}
          value={selections.assignee}
          onValueChange={(value) => {
            select("assignee", value);
            check(value);
          }}
          options={assigneeOptions}
        />
        <TaskFormSelectField
          id="task-milestone"
          label={t("tasks.fields.milestone")}
          value={selections.milestoneId}
          onValueChange={(value) => select("milestoneId", value)}
          options={milestoneOptions(milestones, selections, t("tasks.none"))}
        />
      </div>

      {warning ? (
        <AssigneeSightNotice
          onAddDepartment={(department) => {
            // A saved ticket keeps its departments in the ticket page; only a new one chooses here.
            if (mode === "create") {
              select("departmentIds", [
                ...selections.departmentIds,
                department.id,
              ]);
            }
            dismiss();
          }}
          onDismiss={dismiss}
          sight={mode === "create" ? warning : { ...warning, offer: [] }}
        />
      ) : null}

      <TaskFormTextField
        defaultValue={initialTask?.dueAt ?? ""}
        id="task-due-at"
        label={t("tasks.fields.dueAt")}
        name="dueAt"
        type="date"
      />

      <div className="grid gap-3 sm:grid-cols-2">
        {mode === "edit" && initialTask ? (
          <TaskFormSelectField
            id="task-reporter"
            label={t("tasks.fields.reporter")}
            value={selections.reporterId}
            onValueChange={(value) => select("reporterId", value)}
            options={reporterOptions(initialTask, assignees)}
          />
        ) : null}
        {mode === "create" ? (
          <div className="flex min-w-0 flex-col gap-1.5 sm:col-span-2">
            <span className="text-sm font-medium">
              {t("tasks.fields.department")}
            </span>
            <TicketDepartmentChips
              known={knownDepartments}
              onChange={(departmentIds) =>
                select("departmentIds", departmentIds)
              }
              selectable={departments}
              selectedIds={selections.departmentIds}
            />
          </div>
        ) : null}
        <TaskFormTextField
          defaultValue={initialTask?.startAt ?? ""}
          id="task-start-at"
          label={t("tasks.fields.startAt")}
          name="startAt"
          type="date"
        />
      </div>
    </>
  );
}

/** The inputs of the work item form, grouped from classification to dates. */
export function TaskFormFields(props: TaskFormFieldsProps): React.ReactElement {
  return (
    <>
      {props.mode === "create" ? (
        <TaskFormTemplateField
          select={props.select}
          selections={props.selections}
          templates={props.templates}
        />
      ) : null}
      <ClassificationFields {...props} />
      <TextFields
        initialTask={props.initialTask}
        template={
          props.templates.find(
            (template) => template.id === props.selections.templateId,
          ) ?? null
        }
      />
      <WorkflowFields
        select={props.select}
        selections={props.selections}
        statuses={props.statuses}
      />
      <PeopleAndDateFields {...props} />
    </>
  );
}
