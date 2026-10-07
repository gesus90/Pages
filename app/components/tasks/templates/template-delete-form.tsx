import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";

import { useTemplateFetcher } from "./use-template-fetcher";

import type { WorkItemTemplateView } from "@/definition/WorkItemTemplate";

interface TemplateDeleteFormProps {
  readonly template: WorkItemTemplateView;
  /** The button that leaves the confirmation without deleting. */
  readonly cancel: React.ReactNode;
}

function doNothing(): void {
  // The deleted template leaves the list when the loaders run again.
}

/** Asks for confirmation before a template is deleted with the `delete-template` action. */
export function TemplateDeleteForm({
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
