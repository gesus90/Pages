import { useTranslation } from "react-i18next";
import { Form } from "react-router";

import { ProjectFields } from "./create-project-form/project-fields";

import { ProjectDepartmentChoices } from "@/app/components/projects/project-department-choices";
import { Button } from "@/app/components/ui/button";
import { DialogClose } from "@/app/components/ui/dialog";
import { VerticalScrollArea } from "@/app/components/ui/vertical-scroll-area";

import type { ProjectDepartmentChoices as DepartmentChoiceModel } from "@/definition/Project";
import type { CreateProjectDialogState } from "./use-create-project-dialog";
import type { ProjectTemplate } from "@/definition/Project";

interface CreateProjectFormProps {
  readonly state: CreateProjectDialogState;
  readonly departmentChoices: DepartmentChoiceModel;
  readonly templates: readonly ProjectTemplate[];
}

/** Renders project fields and required department choices within a scrollable modal. */
export function CreateProjectForm({
  state,
  departmentChoices,
  templates,
}: CreateProjectFormProps): React.ReactElement {
  const { t } = useTranslation();
  const {
    error,
    isSubmitting,
    selectedStatus,
    selectedDepartments,
    setSelectedDepartments,
    selectedTemplateId,
  } = state;
  return (
    <Form className="mt-5 flex min-h-0 flex-col" method="post" noValidate>
      <input name="intent" type="hidden" value="create-project" />
      <input name="status" type="hidden" value={selectedStatus} />
      <input name="templateId" type="hidden" value={selectedTemplateId} />
      <VerticalScrollArea
        className="max-h-[60dvh] [--scroll-fade-channels:var(--surface-channels)]"
        contentClassName="flex flex-col gap-4 px-1 pt-1 pb-10"
      >
        <ProjectFields state={state} templates={templates} />
        <ProjectDepartmentChoices
          available={departmentChoices.available}
          selected={selectedDepartments}
          selectionRequired={departmentChoices.selectionRequired}
          onChange={setSelectedDepartments}
        />
        {error ? (
          <p className="pages-selectable text-sm text-destructive" role="alert">
            {t(`projects.error.${error}`)}
          </p>
        ) : null}
      </VerticalScrollArea>
      <div className="mt-6 flex justify-end gap-2">
        <DialogClose asChild>
          <Button variant="ghost">{t("projects.actions.cancel")}</Button>
        </DialogClose>
        <Button
          type="submit"
          isPending={isSubmitting}
          disabled={
            departmentChoices.selectionRequired &&
            selectedDepartments.length === 0
          }
        >
          {t("projects.create.submit")}
        </Button>
      </div>
    </Form>
  );
}
