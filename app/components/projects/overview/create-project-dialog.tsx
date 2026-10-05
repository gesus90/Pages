import { FolderPlus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Form } from "react-router";

import { useCreateProjectDialog } from "@/app/components/projects/overview/use-create-project-dialog";
import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/app/components/ui/dialog";
import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";
import { Textarea } from "@/app/components/ui/textarea";
import { PROJECT_STATUS } from "@/definition/Project";

interface CreateProjectDialogProps {
  readonly canManageProjects: boolean;
}

/** Renders the button and dialog that create a project, for those who may manage projects. */
export function CreateProjectDialog({
  canManageProjects,
}: CreateProjectDialogProps): React.ReactElement | null {
  const { t } = useTranslation();
  const {
    error,
    isOpen,
    isSubmitting,
    selectedStatus,
    setIsOpen,
    setSelectedStatus,
  } = useCreateProjectDialog();

  if (!canManageProjects) {
    return null;
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button>
          <FolderPlus className="size-4" aria-hidden="true" />
          {t("projects.create.trigger")}
        </Button>
      </DialogTrigger>
      <DialogContent className="w-[min(34rem,90vw)]">
        <DialogTitle className="select-none text-lg font-semibold text-foreground">
          {t("projects.create.title")}
        </DialogTitle>
        <Form className="mt-5 flex flex-col gap-3" method="post" noValidate>
          <input name="intent" type="hidden" value="create-project" />
          <input name="status" type="hidden" value={selectedStatus} />
          <label
            className="select-none text-sm font-medium"
            htmlFor="project-name"
          >
            {t("projects.fields.name")}
          </label>
          <Input id="project-name" name="name" required />
          <label
            className="select-none text-sm font-medium"
            htmlFor="project-description"
          >
            {t("projects.fields.description")}
          </label>
          <Textarea
            className="min-h-32 resize-y"
            id="project-description"
            name="description"
          />
          <label
            className="select-none text-sm font-medium"
            htmlFor="project-status"
          >
            {t("projects.fields.status")}
          </label>
          <Select
            id="project-status"
            ariaLabel={t("projects.fields.status")}
            value={selectedStatus}
            onValueChange={setSelectedStatus}
            className="w-full"
            options={Object.values(PROJECT_STATUS).map((status) => ({
              value: status,
              label: t(`projects.status.${status}`),
            }))}
          />
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {t(`projects.error.${error}`)}
            </p>
          ) : null}
          <div className="mt-2 flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="ghost">{t("projects.actions.cancel")}</Button>
            </DialogClose>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting
                ? t("projects.create.submitting")
                : t("projects.create.submit")}
            </Button>
          </div>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
