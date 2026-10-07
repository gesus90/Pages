import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";

import { TemplateSharingFields } from "./template-sharing-fields";
import { useTemplateFetcher } from "./use-template-fetcher";
import { useTemplateSharing } from "./use-template-sharing";

import type { TemplateSharing } from "@/definition/WorkItemTemplate";

interface TemplateDetailsFormProps {
  /** The ticket to save, or the template to change; the form posts it under `field`. */
  readonly target: {
    readonly field: "ticketId" | "templateId";
    readonly id: string;
  };
  readonly initialName: string;
  readonly initialSharing: TemplateSharing;
  /** Prefix that keeps the field ids of several forms on one page apart. */
  readonly idPrefix: string;
  /** The button that leaves the form without saving. */
  readonly cancel: React.ReactNode;
  readonly onSaved: () => void;
}

/** Name and audience of a template, saved with the `save-template` action. */
export function TemplateDetailsForm({
  target,
  initialName,
  initialSharing,
  idPrefix,
  cancel,
  onSaved,
}: TemplateDetailsFormProps): React.ReactElement {
  const { t } = useTranslation();
  const sharing = useTemplateSharing(initialSharing);
  const { fetcher, error } = useTemplateFetcher("save-template", onSaved);

  return (
    <fetcher.Form className="mt-5 flex flex-col gap-4" method="post">
      <input name="intent" type="hidden" value="save-template" />
      <input name={target.field} type="hidden" value={target.id} />
      <div>
        <label
          className="block select-none text-sm font-medium text-foreground"
          htmlFor={`${idPrefix}-name`}
        >
          {t("tasks.templates.name")}
        </label>
        <Input
          className="mt-1"
          defaultValue={initialName}
          id={`${idPrefix}-name`}
          maxLength={80}
          name="name"
          required
        />
      </div>
      <TemplateSharingFields id={`${idPrefix}-scope`} sharing={sharing} />
      {error ? (
        <p className="pages-selectable text-sm text-destructive" role="alert">
          {t(`tasks.error.${error}`, { defaultValue: error })}
        </p>
      ) : null}
      <div className="mt-2 flex justify-end gap-2">
        {cancel}
        <Button isPending={fetcher.state !== "idle"} type="submit">
          {t("tasks.templates.save")}
        </Button>
      </div>
    </fetcher.Form>
  );
}
