import { LayoutTemplate } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/app/components/ui/dialog";

import { TemplateManagerRow } from "./template-manager-row";

import type { WorkItemTemplateView } from "@/definition/WorkItemTemplate";

interface TemplateManagerDialogProps {
  readonly templates: readonly WorkItemTemplateView[];
}

/** Lists the templates the visitor may change and offers to rename, reshare or delete them. */
export function TemplateManagerDialog({
  templates,
}: TemplateManagerDialogProps): React.ReactElement | null {
  const { t } = useTranslation();
  const manageable = templates.filter((template) => template.canManage);

  if (manageable.length === 0) {
    return null;
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button className="gap-2" type="button" variant="outline">
          <LayoutTemplate className="size-4" aria-hidden="true" />
          {t("tasks.templates.manage")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto" size="lg">
        <DialogTitle className="text-lg font-semibold">
          {t("tasks.templates.manageTitle")}
        </DialogTitle>
        <DialogDescription className="mt-3 text-sm leading-relaxed text-muted-foreground">
          {t("tasks.templates.manageHint")}
        </DialogDescription>
        <ul className="mt-5 flex flex-col gap-2">
          {manageable.map((template) => (
            <TemplateManagerRow key={template.id} template={template} />
          ))}
        </ul>
        <footer className="mt-6 flex justify-end">
          <DialogClose asChild>
            <Button variant="ghost">{t("tasks.templates.close")}</Button>
          </DialogClose>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
