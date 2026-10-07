import { useTranslation } from "react-i18next";

import { TaskFormSelectField } from "./task-form-select-field";

import type { WorkItemTemplateView } from "@/definition/WorkItemTemplate";
import type { TaskFormSelectionState } from "./task-form-selections";

interface TaskFormTemplateFieldProps extends TaskFormSelectionState {
  readonly templates: readonly WorkItemTemplateView[];
}

/** Lets a new ticket start from a template; the chosen one presets type, priority, title and description. */
export function TaskFormTemplateField({
  templates,
  select,
  selections,
}: TaskFormTemplateFieldProps): React.ReactElement | null {
  const { t } = useTranslation();
  const chosen = templates.find(
    (template) => template.id === selections.templateId,
  );

  if (templates.length === 0) {
    return null;
  }

  function handleChange(templateId: string): void {
    select("templateId", templateId);

    const template = templates.find((entry) => entry.id === templateId);

    if (!template) {
      return;
    }

    select("priority", template.priority);

    // A ticket created below a parent keeps the type that parent allows.
    if (selections.parentId === "") {
      select("type", template.type);
    }
  }

  return (
    <div>
      <TaskFormSelectField
        id="task-template"
        label={t("tasks.templates.fromTemplate")}
        onValueChange={handleChange}
        options={[
          { label: t("tasks.templates.none"), value: "" },
          ...templates.map((template) => ({
            label: template.name,
            value: template.id,
          })),
        ]}
        value={selections.templateId}
      />
      {chosen ? (
        <p className="mt-1.5 text-xs text-muted-foreground">
          {t("tasks.templates.applyHint", {
            items: chosen.checklist.length,
            labels: chosen.labelIds.length,
          })}
        </p>
      ) : null}
    </div>
  );
}
