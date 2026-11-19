import { LayoutTemplate, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
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

import { TemplateDetailsForm } from "./template-details-form";
import { useTemplateFetcher } from "./use-template-fetcher";

import type { WorkItemTemplateView } from "@/definition/WorkItemTemplate";

interface TemplateManagerDialogProps {
  readonly templates: readonly WorkItemTemplateView[];
}

interface TemplateDeleteFormProps {
  readonly template: WorkItemTemplateView;
  readonly cancel: React.ReactNode;
}

interface TemplateManagerRowProps {
  readonly template: WorkItemTemplateView;
}

type RowMode = "view" | "edit" | "delete";

function doNothing(): void {
  // The deleted template leaves the list when the loaders run again.
}

function TemplateDeleteForm({
  template,
  cancel,
}: TemplateDeleteFormProps): React.ReactElement {
  const { t } = useTranslation();
  const { fetcher, error } = useTemplateFetcher("delete-template", doNothing);

  return (
    <fetcher.Form className="mt-3 flex flex-col gap-3" method="post">
      <input name="intent" type="hidden" value="delete-template" />
      <input name="templateId" type="hidden" value={template.id} />
      <p className="text-sm text-muted-foreground">
        {t("tasks.templates.deleteHint", { name: template.name })}
      </p>
      {error ? (
        <p className="pages-selectable text-sm text-destructive" role="alert">
          {t(`tasks.error.${error}`, { defaultValue: error })}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        {cancel}
        <Button
          isPending={fetcher.state !== "idle"}
          type="submit"
          variant="destructive"
        >
          {t("tasks.templates.deleteConfirm")}
        </Button>
      </div>
    </fetcher.Form>
  );
}

function TemplateManagerRow({
  template,
}: TemplateManagerRowProps): React.ReactElement {
  const { t } = useTranslation();
  const [mode, setMode] = useState<RowMode>("view");

  function close(): void {
    setMode("view");
  }

  const cancel = (
    <Button onClick={close} type="button" variant="ghost">
      {t("tasks.actions.cancel")}
    </Button>
  );

  return (
    <li className="rounded-xl bg-muted/40 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="break-words text-sm font-medium">{template.name}</p>
          <p className="text-xs text-muted-foreground">
            {t(`tasks.templates.scope.${template.scope}`)}
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          <Button
            aria-label={t("tasks.templates.edit", { name: template.name })}
            onClick={() => setMode("edit")}
            size="icon"
            type="button"
            variant="ghost"
          >
            <Pencil className="size-4" aria-hidden="true" />
          </Button>
          <Button
            aria-label={t("tasks.templates.delete", { name: template.name })}
            className="text-destructive hover:text-destructive"
            onClick={() => setMode("delete")}
            size="icon"
            type="button"
            variant="ghost"
          >
            <Trash2 className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </div>
      {mode === "edit" ? (
        <TemplateDetailsForm
          cancel={cancel}
          idPrefix={`template-${template.id}`}
          initialName={template.name}
          initialSharing={template}
          onSaved={close}
          target={{ field: "templateId", id: template.id }}
        />
      ) : null}
      {mode === "delete" ? (
        <TemplateDeleteForm cancel={cancel} template={template} />
      ) : null}
    </li>
  );
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
