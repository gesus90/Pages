import { useTranslation } from "react-i18next";

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
}: Pick<SectionProps, "initialTask">): React.ReactElement {
  const { t } = useTranslation();

  return (
    <>
      <TaskFormTextField
        defaultValue={initialTask?.title ?? ""}
        id="task-title"
        isRequired
        label={t("tasks.fields.title")}
        maxLength={200}
        name="title"
      />
      <TaskFormTextField
        defaultValue={initialTask?.description ?? ""}
        id="task-description"
        label={t("tasks.fields.description")}
        maxLength={10000}
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

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <TaskFormSelectField
          id="task-assignee"
          label={t("tasks.fields.assignee")}
          value={selections.assigneeId}
          onValueChange={(value) => select("assigneeId", value)}
          options={[
            { value: "", label: t("tasks.unassigned") },
            ...assignees.map((assignee) => ({
              value: assignee.id,
              label: assignee.displayName,
            })),
          ]}
        />
        <TaskFormSelectField
          id="task-milestone"
          label={t("tasks.fields.milestone")}
          value={selections.milestoneId}
          onValueChange={(value) => select("milestoneId", value)}
          options={milestoneOptions(milestones, selections, t("tasks.none"))}
        />
      </div>

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
      <ClassificationFields {...props} />
      <TextFields initialTask={props.initialTask} />
      <WorkflowFields
        select={props.select}
        selections={props.selections}
        statuses={props.statuses}
      />
      <PeopleAndDateFields {...props} />
    </>
  );
}
