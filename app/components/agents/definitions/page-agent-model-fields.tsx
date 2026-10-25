import { useTranslation } from "react-i18next";

import { planModelDisplay } from "@/app/components/agents/plans/plan-model-option";
import { Select } from "@/app/components/ui/select";
import { reasoningOptions } from "@/app/lib/reasoning-options";
import { modelsOfSameTarget } from "@/definition/AgentReasoningChoice";

import type { PageAgentInput, PageAgentModel } from "@/definition/PageAgent";

/** Restricts model and reasoning controls to the currently shared connection models. */
export function PageAgentModelFields(props: {
  readonly draft: PageAgentInput;
  readonly models: readonly PageAgentModel[];
  readonly disabled: boolean;
  /** Tells an owner that the saved model is no longer released and has to be replaced. */
  readonly isModelWithdrawn: boolean;
  readonly savedModel?: string;
  /** The family alias the saved model was stored under; its version is chosen once the model or level changes. */
  readonly savedAlias?: string | null;
  readonly layout?: "columns" | "stacked";
  readonly onChange: (draft: PageAgentInput) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const model = props.models.find(
    (entry) => entry.id === props.draft.modelProfileId,
  );
  function selectModel(id: string): void {
    props.onChange({
      ...props.draft,
      modelProfileId: id,
      reasoningEffort: props.draft.reasoningEffort,
    });
  }
  return (
    <div className="space-y-3">
      <div
        className={
          props.layout === "stacked"
            ? "grid min-w-0 gap-4"
            : "grid min-w-0 gap-4 sm:grid-cols-2"
        }
      >
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
              ...props.models.map((entry) => {
                const display = planModelDisplay(entry, t);
                return {
                  value: entry.id,
                  label: `${display.label} · ${entry.model}`,
                  icon: display.icon,
                  description: `${t(`settings.agents.provider.${entry.provider}`)}${entry.isManual ? ` · ${t("picaSettings.manual")}` : ""}${display.free}`,
                };
              }),
            ]}
          />
        </label>
        <PageAgentReasoningField
          draft={props.draft}
          models={props.models}
          model={model}
          savedModel={props.savedModel}
          disabled={props.disabled}
          onChange={props.onChange}
        />
      </div>
      <PageAgentModelNotices
        model={model}
        savedAlias={props.savedAlias ?? null}
        isModelWithdrawn={props.isModelWithdrawn}
      />
    </div>
  );
}

/** The reasoning level of a model; levels the model lacks stay listed, disabled, with the reason. */
function PageAgentReasoningField(props: {
  readonly draft: PageAgentInput;
  readonly models: readonly PageAgentModel[];
  readonly model: PageAgentModel | undefined;
  readonly savedModel: string | undefined;
  readonly disabled: boolean;
  readonly onChange: (draft: PageAgentInput) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const { draft, model } = props;
  const efforts = model?.reasoningEfforts ?? [];
  const options = reasoningOptions({
    model,
    modelName: model?.modelName ?? model?.name ?? props.savedModel ?? "",
    siblings: modelsOfSameTarget(props.models, model),
    current: draft.reasoningEffort,
    defaultLabel: t("pageAgents.defaultReasoning"),
    translate: t,
  });
  return (
    <label className="block min-w-0 space-y-2 text-sm font-medium">
      <span>{t("pageAgents.reasoning")}</span>
      <Select
        value={draft.reasoningEffort ?? ""}
        className="w-full [&>span]:min-w-0 [&>span]:truncate"
        disabled={props.disabled || options.length === 1}
        // Only a listed level is a choice; the fixed default reports as empty.
        onValueChange={(effort) =>
          props.onChange({
            ...draft,
            reasoningEffort: efforts.includes(effort) ? effort : null,
          })
        }
        ariaLabel={t("pageAgents.reasoning")}
        options={options}
      />
    </label>
  );
}

function PageAgentModelNotices(props: {
  readonly model: PageAgentModel | undefined;
  readonly savedAlias: string | null;
  readonly isModelWithdrawn: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  const { model, savedAlias } = props;
  return (
    <>
      {savedAlias && model ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t("pageAgents.modelAlias", {
            alias: savedAlias,
            model: model.modelName ?? model.name,
            id: model.model,
          })}
        </p>
      ) : null}
      {props.isModelWithdrawn ? (
        <p role="status" className="text-sm text-warning">
          {t("pageAgents.modelWithdrawn")}
        </p>
      ) : null}
    </>
  );
}
