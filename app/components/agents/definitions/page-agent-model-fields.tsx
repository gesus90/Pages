import { useTranslation } from "react-i18next";

import { ModelPicker } from "@/app/components/agents/model-picker";
import {
  ModelFieldRow,
  ReasoningField,
} from "@/app/components/agents/model-picker/model-field";
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
  readonly onChange: (draft: PageAgentInput) => void;
}): React.ReactElement {
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
      <ModelFieldRow>
        <ModelPicker
          value={props.draft.modelProfileId}
          models={props.models}
          savedModel={props.savedModel}
          disabled={props.disabled}
          onChange={selectModel}
        />
        <PageAgentReasoningField
          draft={props.draft}
          models={props.models}
          model={model}
          savedModel={props.savedModel}
          disabled={props.disabled}
          onChange={props.onChange}
        />
      </ModelFieldRow>
      <PageAgentModelNotices
        model={model}
        savedAlias={props.savedAlias ?? null}
        isModelWithdrawn={props.isModelWithdrawn}
      />
    </div>
  );
}

/** The reasoning level of a model; levels the model lacks stay listed, disabled, with the reason. */
export function PageAgentReasoningField(props: {
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
  // Only a listed level is a choice; the fixed default reports as empty.
  function selectEffort(effort: string): void {
    props.onChange({
      ...draft,
      reasoningEffort: efforts.includes(effort) ? effort : null,
    });
  }
  return (
    <ReasoningField
      value={draft.reasoningEffort ?? ""}
      options={options}
      disabled={props.disabled}
      onChange={selectEffort}
    />
  );
}

/** Names the alias a saved model stands for, and a saved model that is no longer released. */
export function PageAgentModelNotices(props: {
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
