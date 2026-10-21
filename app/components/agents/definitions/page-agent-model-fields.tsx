import { useTranslation } from "react-i18next";

import { Select } from "@/app/components/ui/select";

import type { PageAgentInput, PageAgentModel } from "@/definition/PageAgent";

/** Restricts model and reasoning controls to the currently shared connection models. */
export function PageAgentModelFields(props: {
  readonly draft: PageAgentInput;
  readonly models: readonly PageAgentModel[];
  readonly disabled: boolean;
  /** Tells an owner that the saved model is no longer released and has to be replaced. */
  readonly isModelWithdrawn: boolean;
  readonly savedModel?: string;
  readonly onChange: (draft: PageAgentInput) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const model = props.models.find(
    (entry) => entry.id === props.draft.modelProfileId,
  );
  const efforts = model?.reasoningEfforts ?? [];
  function selectModel(id: string): void {
    props.onChange({
      ...props.draft,
      modelProfileId: id,
      reasoningEffort: props.draft.reasoningEffort,
    });
  }
  return (
    <div className="space-y-3">
      <div className="grid min-w-0 gap-4 sm:grid-cols-2">
        <label className="block min-w-0 space-y-2 text-sm font-medium">
          <span>{t("pageAgents.model")}</span>
          <Select
            value={props.draft.modelProfileId}
            ariaLabel={t("pageAgents.model")}
            disabled={props.disabled}
            onValueChange={selectModel}
            className="w-full [&>span]:min-w-0 [&>span]:truncate"
            options={[
              ...(!model
                ? [
                    {
                      value: props.draft.modelProfileId,
                      label: `${props.savedModel ? `${props.savedModel} · ` : ""}${t("pageAgents.missingModel")}`,
                      disabled: true,
                    },
                  ]
                : []),
              ...props.models.map((entry) => ({
                value: entry.id,
                label: `${entry.name} · ${entry.model}`,
                description: `${t(`settings.agents.provider.${entry.provider}`)}${entry.isManual ? ` · ${t("picaSettings.manual")}` : ""}`,
              })),
            ]}
          />
        </label>
        <label className="block min-w-0 space-y-2 text-sm font-medium">
          <span>{t("pageAgents.reasoning")}</span>
          <Select
            value={props.draft.reasoningEffort ?? ""}
            className="w-full [&>span]:min-w-0 [&>span]:truncate"
            disabled={
              props.disabled ||
              (efforts.length === 0 && props.draft.reasoningEffort === null)
            }
            // Only a listed level is a choice; the fixed default reports as empty.
            onValueChange={(effort) =>
              props.onChange({
                ...props.draft,
                reasoningEffort: efforts.includes(effort) ? effort : null,
              })
            }
            ariaLabel={t("pageAgents.reasoning")}
            options={[
              { value: "", label: t("pageAgents.defaultReasoning") },
              ...efforts.map((effort) => ({ value: effort, label: effort })),
              ...(props.draft.reasoningEffort &&
              !efforts.includes(props.draft.reasoningEffort)
                ? [
                    {
                      value: props.draft.reasoningEffort,
                      label: `${props.draft.reasoningEffort}${model ? ` · ${t("picaSettings.unsupportedEffort")}` : ""}`,
                      disabled: true,
                    },
                  ]
                : []),
            ]}
          />
        </label>
      </div>
      {props.isModelWithdrawn ? (
        <p role="status" className="text-sm text-warning">
          {t("pageAgents.modelWithdrawn")}
        </p>
      ) : null}
    </div>
  );
}
