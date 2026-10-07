import { useTranslation } from "react-i18next";

import { useTicketAccess } from "@/app/components/tasks/ticket-access";
import { Select } from "@/app/components/ui/select";
import { TEMPLATE_SCOPE } from "@/definition/WorkItemTemplate";

import { TemplateShareList } from "./template-share-list";

import type { TemplateSharingState } from "./use-template-sharing";

interface TemplateSharingFieldsProps {
  readonly sharing: TemplateSharingState;
  /** Id of the scope select, which its label points at. */
  readonly id: string;
}

/** The select for whom a template is shared with, and the choices its scope needs. */
export function TemplateSharingFields({
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
