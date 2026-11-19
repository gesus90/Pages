import { useState } from "react";
import { useTranslation } from "react-i18next";

import { useTicketAccess } from "@/app/components/tasks/ticket-access";
import { Button } from "@/app/components/ui/button";
import { Checkbox } from "@/app/components/ui/checkbox";
import { Input } from "@/app/components/ui/input";
import { ScrollViewport } from "@/app/components/ui/scroll-viewport";
import { Select } from "@/app/components/ui/select";
import { TEMPLATE_SCOPE } from "@/definition/WorkItemTemplate";

import { useTemplateFetcher } from "./use-template-fetcher";

import type {
  TemplateScope,
  TemplateSharing,
} from "@/definition/WorkItemTemplate";

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

interface TemplateSharingState extends TemplateSharing {
  readonly setScope: (scope: TemplateScope) => void;
  readonly toggleDepartment: (departmentId: string) => void;
  readonly toggleProject: (projectId: string) => void;
}

interface TemplateShareListProps {
  readonly legend: string;
  readonly name: string;
  readonly choices: readonly { readonly id: string; readonly name: string }[];
  readonly selected: readonly string[];
  readonly emptyHint: string;
  readonly onToggle: (id: string) => void;
}

interface TemplateSharingFieldsProps {
  readonly sharing: TemplateSharingState;
  readonly id: string;
}

function toggled(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((entry) => entry !== id) : [...ids, id];
}

function useTemplateSharing(initial: TemplateSharing): TemplateSharingState {
  const [scope, setScope] = useState(initial.scope);
  const [departmentIds, setDepartmentIds] = useState(initial.departmentIds);
  const [projectIds, setProjectIds] = useState(initial.projectIds);

  return {
    departmentIds,
    projectIds,
    scope,
    setScope,
    toggleDepartment: (departmentId) =>
      setDepartmentIds((current) => toggled(current, departmentId)),
    toggleProject: (projectId) =>
      setProjectIds((current) => toggled(current, projectId)),
  };
}

function TemplateShareList({
  legend,
  name,
  choices,
  selected,
  emptyHint,
  onToggle,
}: TemplateShareListProps): React.ReactElement {
  return (
    <fieldset className="flex min-w-0 flex-col gap-1">
      <legend className="mb-1 text-sm font-medium">{legend}</legend>
      {choices.length === 0 ? (
        <p className="text-xs text-muted-foreground">{emptyHint}</p>
      ) : (
        <ScrollViewport
          axis="vertical"
          containerClassName="max-h-40"
          className="flex flex-col gap-1 overflow-y-auto"
        >
          {choices.map((choice) => (
            <label
              key={choice.id}
              className="flex min-h-11 items-center gap-3 rounded-xl px-2 text-sm hover:bg-muted/40 xl:min-h-9"
            >
              <Checkbox
                checked={selected.includes(choice.id)}
                name={name}
                onChange={() => onToggle(choice.id)}
                value={choice.id}
              />
              <span className="min-w-0 break-words">{choice.name}</span>
            </label>
          ))}
        </ScrollViewport>
      )}
    </fieldset>
  );
}

function TemplateSharingFields({
  sharing,
  id,
}: TemplateSharingFieldsProps): React.ReactElement {
  const { t } = useTranslation();
  const { departments, projects } = useTicketAccess();

  return (
    <>
      <div>
        <label
          className="block select-none text-sm font-medium text-foreground"
          htmlFor={id}
        >
          {t("tasks.templates.scope.label")}
        </label>
        <input name="scope" type="hidden" value={sharing.scope} />
        <Select
          ariaLabel={t("tasks.templates.scope.label")}
          className="min-w-36"
          id={id}
          onValueChange={sharing.setScope}
          options={Object.values(TEMPLATE_SCOPE).map((scope) => ({
            label: t(`tasks.templates.scope.${scope}`),
            value: scope,
          }))}
          value={sharing.scope}
        />
      </div>

      {sharing.scope === TEMPLATE_SCOPE.DEPARTMENTS ? (
        <TemplateShareList
          choices={departments}
          emptyHint={t("tasks.templates.sharing.noDepartments")}
          legend={t("tasks.templates.sharing.departments")}
          name="departmentIds"
          onToggle={sharing.toggleDepartment}
          selected={sharing.departmentIds}
        />
      ) : null}

      {sharing.scope === TEMPLATE_SCOPE.PROJECTS ? (
        <TemplateShareList
          choices={projects}
          emptyHint={t("tasks.templates.sharing.noProjects")}
          legend={t("tasks.templates.sharing.projects")}
          name="projectIds"
          onToggle={sharing.toggleProject}
          selected={sharing.projectIds}
        />
      ) : null}
    </>
  );
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
