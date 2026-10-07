import { FolderPlus } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useCreateProjectDialog } from "@/app/components/projects/overview/use-create-project-dialog";
import { CreateProjectForm } from "./create-project-form";
import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/app/components/ui/dialog";
import type { ProjectDepartmentChoices as DepartmentChoiceModel } from "@/definition/Project";
import type { ProjectTemplate } from "@/definition/Project";

interface CreateProjectDialogProps {
  readonly canManageProjects: boolean;
  readonly departmentChoices: DepartmentChoiceModel;
  readonly templates?: readonly ProjectTemplate[];
}

/** Renders the button and dialog that create a project, for those who may manage projects. */
export function CreateProjectDialog({
  canManageProjects,
  departmentChoices,
  templates = [],
}: CreateProjectDialogProps): React.ReactElement | null {
  const { t } = useTranslation();
  const state = useCreateProjectDialog();

  if (!canManageProjects) {
    return null;
  }

  return (
    <Dialog open={state.isOpen} onOpenChange={state.setIsOpen}>
      <DialogTrigger asChild>
        <Button>
          <FolderPlus className="size-4" aria-hidden="true" />
          {t("projects.create.trigger")}
        </Button>
      </DialogTrigger>
      <DialogContent size="md" className="flex flex-col">
        <DialogTitle className="text-lg font-semibold text-foreground">
          {t("projects.create.title")}
        </DialogTitle>
        <CreateProjectForm
          state={state}
          departmentChoices={departmentChoices}
          templates={templates}
        />
      </DialogContent>
    </Dialog>
  );
}
