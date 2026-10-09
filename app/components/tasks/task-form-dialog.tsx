import { useTranslation } from "react-i18next";
import { Form } from "react-router";

import { Dialog, DialogContent, DialogTitle } from "@/app/components/ui/dialog";
import { WORK_ITEM_TYPE } from "@/definition/Task";

import { TaskFormFields } from "./form/task-form-fields";
import { TaskFormFooter } from "./form/task-form-footer";
import { TaskFormHiddenInputs } from "./form/task-form-hidden-inputs";
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
