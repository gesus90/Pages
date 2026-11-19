import { useTranslation } from "react-i18next";
import { Form } from "react-router";

import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@/app/components/ui/dialog";
import { splitAssigneeValue } from "@/app/lib/assignee-value";
import { WORK_ITEM_TYPE } from "@/definition/Task";
import { taskUpdateSnapshot } from "@/definition/TaskUpdateSnapshot";

import { TaskFormFields } from "./form/task-form-fields";
import { useTaskFormSelections } from "./form/task-form-selections";

import type { Project } from "@/definition/Project";
import type {
  Milestone,
  WorkItemDetail,
  WorkItemType,
  WorkflowStatus,
} from "@/definition/Task";
import type { User } from "@/definition/User";
import type { WorkItemTemplateView } from "@/definition/WorkItemTemplate";
import type { TaskFormSelections } from "./form/task-form-selections";

interface TaskFormDialogProps {
  readonly isOpen: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly mode: "create" | "edit";
  readonly initialTask?: WorkItemDetail | null;
  readonly defaultProjectId?: string | null;
  readonly defaultParentId?: string | null;
  readonly defaultType?: WorkItemType;
  readonly defaultStatusId?: string | null;
  readonly projects: readonly Project[];
  readonly statuses: readonly WorkflowStatus[];
  readonly milestones: readonly Milestone[];
  readonly assignees: readonly User[];
  readonly existingWorkItems: readonly WorkItemDetail[];
  readonly isSubmitting: boolean;
  readonly error?: string | null;
  readonly templates?: readonly WorkItemTemplateView[];
}

interface TaskFormHiddenInputsProps {
  readonly mode: "create" | "edit";
  readonly editedItemId: string | undefined;
  readonly baseDescription: string | undefined;
  readonly expectedSnapshot: string | undefined;
  readonly selections: TaskFormSelections;
}

interface TaskFormFooterProps {
  readonly mode: "create" | "edit";
  readonly isSubmitting: boolean;
  readonly error: string | null;
}

function TaskFormHiddenInputs({
  mode,
  editedItemId,
  baseDescription,
  expectedSnapshot,
  selections,
}: TaskFormHiddenInputsProps): React.ReactElement {
  const assignee = splitAssigneeValue(selections.assignee);

  return (
    <>
      <input
        name="intent"
        type="hidden"
        value={mode === "create" ? "create-task" : "update-task"}
      />
      <input name="boardLocal" type="hidden" value="true" />
      {editedItemId ? (
        <input name="id" type="hidden" value={editedItemId} />
      ) : null}
      <input name="type" type="hidden" value={selections.type} />
      <input name="projectId" type="hidden" value={selections.projectId} />
      <input name="statusId" type="hidden" value={selections.statusId} />
      <input name="priority" type="hidden" value={selections.priority} />
      <input name="assigneeId" type="hidden" value={assignee.assigneeId} />
      <input
        name="assigneeGroupId"
        type="hidden"
        value={assignee.assigneeGroupId}
      />
      <input name="milestoneId" type="hidden" value={selections.milestoneId} />
      <input name="parentId" type="hidden" value={selections.parentId} />
      {mode === "edit" ? (
        <>
          <input
            name="reporterId"
            type="hidden"
            value={selections.reporterId}
          />
          <input
            name="baseDescription"
            type="hidden"
            value={baseDescription ?? ""}
          />
          {expectedSnapshot ? (
            <input
              name="expectedSnapshot"
              type="hidden"
              value={expectedSnapshot}
            />
          ) : null}
        </>
      ) : (
        <>
          {selections.departmentIds.map((departmentId) => (
            <input
              key={departmentId}
              name="departmentIds"
              type="hidden"
              value={departmentId}
            />
          ))}
          <input
            name="templateId"
            type="hidden"
            value={selections.templateId}
          />
        </>
      )}
    </>
  );
}

function TaskFormFooter({
  mode,
  isSubmitting,
  error,
}: TaskFormFooterProps): React.ReactElement {
  const { t } = useTranslation();
  const submitLabels = {
    create: {
      idle: t("tasks.create.submit"),
      busy: t("tasks.create.submitting"),
    },
    edit: { idle: t("tasks.edit.submit"), busy: t("tasks.edit.submitting") },
  }[mode];

  return (
    <>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {t(`tasks.error.${error}`, { defaultValue: error })}
        </p>
      ) : null}

      <div className="mt-2 flex justify-end gap-2">
        <DialogClose asChild>
          <Button variant="ghost">{t("tasks.actions.cancel")}</Button>
        </DialogClose>
        <Button disabled={isSubmitting} type="submit">
          {isSubmitting ? submitLabels.busy : submitLabels.idle}
        </Button>
      </div>
    </>
  );
}

/** Modal dialog for creating and editing work items with server-enforced hierarchy rules. */
export function TaskFormDialog({
  isOpen,
  onOpenChange,
  mode,
  initialTask = null,
  defaultProjectId = null,
  defaultParentId = null,
  defaultType = WORK_ITEM_TYPE.TASK,
  defaultStatusId = null,
  projects,
  statuses,
  milestones,
  assignees,
  existingWorkItems,
  isSubmitting,
  error = null,
  templates = [],
}: TaskFormDialogProps): React.ReactElement {
  const { t } = useTranslation();
  const { select, selections } = useTaskFormSelections(isOpen, {
    defaultParentId,
    defaultProjectId,
    defaultStatusId,
    defaultType,
    initialTask,
    projects,
    statuses,
  });

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[min(38rem,94vw)] overflow-y-auto">
        <DialogTitle className="select-none text-lg font-semibold text-foreground">
          {mode === "create" ? t("tasks.create.title") : t("tasks.edit.title")}
        </DialogTitle>

        <Form className="mt-5 flex flex-col gap-4" method="post" noValidate>
          <TaskFormHiddenInputs
            baseDescription={initialTask?.description}
            editedItemId={initialTask?.id}
            expectedSnapshot={
              initialTask
                ? JSON.stringify(taskUpdateSnapshot(initialTask))
                : undefined
            }
            mode={mode}
            selections={selections}
          />
          <TaskFormFields
            assignees={assignees}
            existingWorkItems={existingWorkItems}
            initialTask={initialTask}
            milestones={milestones}
            mode={mode}
            projects={projects}
            select={select}
            selections={selections}
            statuses={statuses}
            templates={templates}
          />
          <TaskFormFooter
            error={error}
            isSubmitting={isSubmitting}
            mode={mode}
          />
        </Form>
      </DialogContent>
    </Dialog>
  );
}
