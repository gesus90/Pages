import { Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";

import { TemplateDeleteForm } from "./template-delete-form";
import { TemplateDetailsForm } from "./template-details-form";

import type { WorkItemTemplateView } from "@/definition/WorkItemTemplate";

interface TemplateManagerRowProps {
  readonly template: WorkItemTemplateView;
}

type RowMode = "view" | "edit" | "delete";

/** One template of the manager with its name, audience and the controls to change or remove it. */
export function TemplateManagerRow({
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
