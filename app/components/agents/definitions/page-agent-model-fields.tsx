import { useTranslation } from "react-i18next";

import { Select } from "@/app/components/ui/select";

import type { PageAgentInput, PageAgentModel } from "@/definition/PageAgent";

/** Restricts model and reasoning controls to the server-provided admin grants. */
export function PageAgentModelFields(props: {
  readonly draft: PageAgentInput;
  readonly models: readonly PageAgentModel[];
  readonly disabled: boolean;
  readonly onChange: (draft: PageAgentInput) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const model = props.models.find(
    (entry) => entry.id === props.draft.modelProfileId,
  );
  function selectModel(id: string): void {
    const selected = props.models.find((entry) => entry.id === id);
    if (selected)
      props.onChange({
        ...props.draft,
        modelProfileId: id,
        reasoningEffort: selected.reasoningEffort,
      });
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="block space-y-2 text-sm font-medium">
        <span>{t("pageAgents.model")}</span>
        <Select
          value={props.draft.modelProfileId}
          disabled={props.disabled}
          onValueChange={selectModel}
          options={props.models.map((entry) => ({
            value: entry.id,
            label: `${entry.name} · ${entry.model}`,
          }))}
        />
      </label>
      <label className="block space-y-2 text-sm font-medium">
        <span>{t("pageAgents.reasoning")}</span>
        <Select
          value={props.draft.reasoningEffort ?? ""}
          disabled={props.disabled}
          onValueChange={(effort) =>
            props.onChange({ ...props.draft, reasoningEffort: effort || null })
          }
          options={
            model?.reasoningEfforts.length
              ? model.reasoningEfforts.map((effort) => ({
                  value: effort,
                  label: effort,
                }))
              : [{ value: "", label: t("pageAgents.defaultReasoning") }]
          }
        />
      </label>
    </div>
  );
}
