import { useTranslation } from "react-i18next";

import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";
import { Textarea } from "@/app/components/ui/textarea";
import { PROJECT_STATUS } from "@/definition/Project";
import { ProjectTemplateSummary } from "../project-template-summary";

import type { ProjectTemplate } from "@/definition/Project";
import type { CreateProjectDialogState } from "../use-create-project-dialog";

interface ProjectFieldsProps {
  readonly state: CreateProjectDialogState;
  readonly templates: readonly ProjectTemplate[];
}

/** Shows general fields and a source-bound template preview while keeping the new name explicit. */
export function ProjectFields({
  state,
  templates,
}: ProjectFieldsProps): React.ReactElement {
  const { t } = useTranslation();
  const {
    selectedStatus,
    setSelectedStatus,
    selectedTemplateId,
    setSelectedTemplateId,
  } = state;
  const selectedTemplate =
    templates.find((template) => template.id === selectedTemplateId) ?? null;
  function handleTemplateChange(id: string): void {
    setSelectedTemplateId(id);
    setSelectedStatus(
      templates.find((template) => template.id === id)?.status ??
        PROJECT_STATUS.PLANNED,
    );
  }
  return (
    <>
      {templates.length > 0 ? (
        <div className="flex flex-col gap-2">
          <label htmlFor="project-template" className="text-sm font-medium">
            {t("projects.templates.label")}
          </label>
          <Select
            size="default"
            id="project-template"
            ariaLabel={t("projects.templates.label")}
            value={selectedTemplateId}
            onValueChange={handleTemplateChange}
            options={[
              { value: "", label: t("projects.templates.none") },
              ...templates.map((template) => ({
                value: template.id,
                label: template.name,
              })),
            ]}
          />
        </div>
      ) : null}
      <label className="text-sm font-medium" htmlFor="project-name">
        {t("projects.fields.name")}
      </label>
      <Input id="project-name" name="name" required />
      <label className="text-sm font-medium" htmlFor="project-description">
        {t("projects.fields.description")}
      </label>
      <Textarea
        key={selectedTemplate?.id ?? "new"}
        className="min-h-32 resize-y"
        id="project-description"
        name="description"
        defaultValue={selectedTemplate?.description ?? ""}
        readOnly={selectedTemplate !== null}
      />
      <label className="text-sm font-medium" htmlFor="project-status">
        {t("projects.fields.status")}
      </label>
      <Select
        size="default"
        id="project-status"
        ariaLabel={t("projects.fields.status")}
        value={selectedStatus}
        onValueChange={setSelectedStatus}
        className="w-full"
        options={Object.values(PROJECT_STATUS).map((status) => ({
          value: status,
          label: t(`projects.status.${status}`),
        }))}
        disabled={selectedTemplate !== null}
      />
      <ProjectTemplateSummary template={selectedTemplate} />
    </>
  );
}
