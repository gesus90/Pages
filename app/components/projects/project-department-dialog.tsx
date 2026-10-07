import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Form, useActionData, useNavigation } from "react-router";

import { ProjectDepartmentChoices } from "@/app/components/projects/project-department-choices";
import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/app/components/ui/dialog";

import type { ProjectDetailActionResult } from "@/app/lib/project-actions/project-action-support.server";
import type {
  Project,
  ProjectDepartmentChoices as DepartmentChoiceModel,
} from "@/definition/Project";

interface ProjectDepartmentDialogProps {
  readonly project: Project;
  readonly choices: DepartmentChoiceModel;
}

/** Edits the complete assignment with the same mandatory multiple selection as project creation. */
export function ProjectDepartmentDialog({
  project,
  choices,
}: ProjectDepartmentDialogProps): React.ReactElement {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const previousProject = useRef(project);
  const [selected, setSelected] = useState(
    project.departments.map((department) => department.id),
  );
  const navigation = useNavigation();
  const outcome = useActionData<ProjectDetailActionResult | undefined>();
  const pending =
    navigation.state === "submitting" &&
    navigation.formData?.get("intent") === "set-departments";
  useEffect(() => {
    if (project === previousProject.current) return;
    previousProject.current = project;
    setOpen(false);
  }, [project]);
  function handleOpen(next: boolean): void {
    if (next)
      setSelected(project.departments.map((department) => department.id));
    setOpen(next);
  }
  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogTrigger asChild>
        <Button variant="link">{t("projects.departments.edit")}</Button>
      </DialogTrigger>
      <DialogContent size="md" className="flex flex-col">
        <DialogTitle className="text-lg font-semibold">
          {t("projects.departments.editTitle")}
        </DialogTitle>
        <Form method="post" className="mt-5 flex min-h-0 flex-col gap-4">
          <input type="hidden" name="intent" value="set-departments" />
          <ProjectDepartmentChoices
            available={choices.available}
            selected={selected}
            selectionRequired={choices.selectionRequired}
            onChange={setSelected}
          />
          {outcome && !outcome.ok ? (
            <p
              role="alert"
              className="pages-selectable text-sm text-destructive"
            >
              {t(`projects.error.${outcome.error}`)}
            </p>
          ) : null}
          <footer className="mt-3 flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="ghost">{t("projects.actions.cancel")}</Button>
            </DialogClose>
            <Button
              type="submit"
              isPending={pending}
              disabled={choices.selectionRequired && selected.length === 0}
            >
              {t("projects.edit.submit")}
            </Button>
          </footer>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
