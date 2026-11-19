import { useTranslation } from "react-i18next";

import { ModelPicker } from "@/app/components/agents/model-picker";
import {
  findModelChoice,
  modelChoiceSource,
  modelGroups,
} from "@/app/components/agents/model-picker/model-catalog";
import { reasoningOptions } from "@/app/lib/reasoning-options";
import { modelsOfSameTarget } from "@/definition/AgentReasoningChoice";
import {
  planMemberProviderRefusal,
  planStepProvider,
} from "@/definition/AgentPlanGroup";
import { findPlanStep } from "@/definition/AgentPlanGroupEdit";
import { effectivePlanTarget } from "@/definition/AgentPlanTarget";
import {
  planTargetModels,
  copyPlanConfiguration,
  planConfigurationModelKey,
  planSavedModel,
} from "@/definition/AgentPlanConfiguration";

import { usePlanFlowContext } from "../plan-flow-context";
import { planStepWithModel } from "../plan-node-configuration-fields";
import {
  PlanModelValue,
  PlanReasoningField,
  PlanReasoningValue,
} from "./plan-agent-fields";

import type { AgentPlanStep } from "@/definition/AgentPlan";
import type { AgentPlanConfiguration } from "@/definition/AgentPlanConfiguration";
import type { AgentPlanGroup } from "@/definition/AgentPlanGroup";
import type { PageAgentModel } from "@/definition/PageAgent";

/**
 * The footer: a 1 px line above 64 px, 12 px padding on every side around
 * the 40 px fields, two equally wide columns 8 px apart, so a field is
 * 143 px wide on a 320 px card and 138 px on the narrowest 310 px card,
 * whatever it shows.
 */
const FOOTER_CLASS =
  "grid h-[65px] shrink-0 grid-cols-2 items-center gap-2 border-t border-border p-3";

/**
 * Model and reasoning of an agent node at the bottom of its card, each as a
 * fixed field whose whole surface is the badge of its value.
 * @remarks
 * Both fields are 40 px high and equally wide and built alike: the model's
 * tile or the level's sign in the same 28 px place, the name in the
 * foreground color, cut with an ellipsis when it is too long, and the muted
 * arrow at the right edge. Choosing another model or level changes only
 * tile or sign, border color and name, never a field, an arrow or the
 * footer.
 * The list offers known models of connections currently shared with the person.
 * Choosing one pins its connection, model and provider on this node only;
 * instructions, bindings, reasoning and run options stay as they are. A member of an ACP
 * group shares the group's session, which never spans runners, so models of
 * another runner are not listed; a saved one names the way out: drag the
 * agent out of the frame. Without edit rights or without a released model
 * the card shows the effective values read only.
 */
export function PlanAgentModel(props: {
  readonly step: AgentPlanStep;
}): React.ReactElement {
  const { sources, canEdit, draft } = usePlanFlowContext();
  const { step } = props;
  const agent = sources.agents.find((entry) => entry.id === step.agentId);
  const configuration =
    step.configuration ?? (agent ? copyPlanConfiguration(agent) : null);
  if (!configuration)
    return (
      <footer className={FOOTER_CLASS}>
        <PlanModelValue choice={null} savedModel="" />
        <PlanReasoningValue reasoning={null} levels={[]} />
      </footer>
    );
  const models = planTargetModels(
    sources.models ?? [],
    effectivePlanTarget(step, draft),
  );
  const saved = planSavedModel(models, configuration);
  const model = saved?.model;
  if (!canEdit || models.length === 0)
    return (
      <ModelValues
        models={models}
        model={model}
        savedModel={configuration.model}
        savedProvider={configuration.provider}
        reasoning={configuration.reasoningEffort}
      />
    );
  return (
    <ModelChoice
      step={step}
      configuration={configuration}
      models={models}
      model={model}
      group={findPlanStep(draft, step.id)?.group ?? null}
    />
  );
}

/** The effective model and reasoning level, read only. */
function ModelValues(props: {
  readonly models: readonly PageAgentModel[];
  readonly model: PageAgentModel | undefined;
  readonly savedModel: string;
  readonly savedProvider: AgentPlanConfiguration["provider"];
  readonly reasoning: string | null;
}): React.ReactElement {
  const { t } = useTranslation();
  const { model } = props;
  const provider = model?.provider ?? props.savedProvider;
  const levels = model?.reasoningEfforts ?? [];
  const selected = model
    ? findModelChoice(
        modelGroups(props.models, { translate: t, selectedId: model.id }),
        model.id,
      )
    : null;
  return (
    <footer className={FOOTER_CLASS}>
      <PlanModelValue
        choice={
          selected
            ? {
                mark: selected.group.mark,
                name: selected.choice.label,
                tool: selected.group.label,
                source: modelChoiceSource(selected.choice.model, t),
              }
            : null
        }
        savedModel={props.savedModel}
        savedProvider={provider}
      />
      <PlanReasoningValue
        reasoning={
          provider === "openrouter" && levels.length === 0
            ? null
            : props.reasoning
        }
        levels={levels}
      />
    </footer>
  );
}

/**
 * Why a model cannot join the node's group: models of another runner are not
 * listed, and the saved one names the reason and the way to choose another.
 */
function useGroupRefusal(input: {
  readonly step: AgentPlanStep;
  readonly group: AgentPlanGroup | null;
}): ((model: PageAgentModel) => string | null) | undefined {
  const { t } = useTranslation();
  const { sources } = usePlanFlowContext();
  const { group, step } = input;
  if (!group) return undefined;
  const adapter = group.steps
    .filter((member) => member.id !== step.id)
    .map((member) => planStepProvider(member, sources.agents))
    .find((provider) => provider !== null);
  return (model) => {
    const refusal = planMemberProviderRefusal(
      group,
      step.id,
      model.provider,
      sources.agents,
    );
    return refusal
      ? t(`plans.modelRefusal.${refusal}`, {
          runner: t(`settings.agents.providerShort.${model.provider}`),
          adapter: adapter ? t(`settings.agents.providerShort.${adapter}`) : "",
        })
      : null;
  };
}

function ModelChoice(props: {
  readonly step: AgentPlanStep;
  readonly configuration: AgentPlanConfiguration;
  readonly models: readonly PageAgentModel[];
  readonly model: PageAgentModel | undefined;
  readonly group: AgentPlanGroup | null;
}): React.ReactElement {
  const { t } = useTranslation();
  const { graph } = usePlanFlowContext();
  const { step, configuration, model } = props;
  const refusalOf = useGroupRefusal(props);
  const efforts = model?.reasoningEfforts ?? [];
  const provider = model?.provider ?? configuration.provider;
  const effortOptions = reasoningOptions({
    model,
    modelName: model?.modelName ?? model?.name ?? configuration.model,
    siblings: modelsOfSameTarget(props.models, model),
    current: configuration.reasoningEffort,
    defaultLabel: t("pageAgents.defaultReasoning"),
    translate: t,
  });
  function selectModel(id: string): void {
    const selected = props.models.find((entry) => entry.id === id);
    // Retain the saved effort so an unsupported choice remains explicit.
    if (selected)
      graph.replaceNode(
        planStepWithModel(
          step,
          configuration,
          selected,
          configuration.reasoningEffort,
        ),
      );
  }
  function selectEffort(effort: string): void {
    if (model)
      graph.replaceNode(
        planStepWithModel(
          step,
          configuration,
          model,
          efforts.includes(effort) ? effort : null,
        ),
      );
  }
  return (
    <footer className={FOOTER_CLASS}>
      <ModelPicker
        value={model ? model.id : planConfigurationModelKey(configuration)}
        models={props.models}
        savedModel={configuration.model}
        savedProvider={provider}
        disabled={false}
        isLabelHidden
        mode="floating"
        valueStyle="badge"
        refusalOf={refusalOf}
        onChange={selectModel}
      />
      <PlanReasoningField
        value={
          provider === "openrouter" && efforts.length === 0
            ? ""
            : (configuration.reasoningEffort ?? "")
        }
        options={effortOptions}
        onChange={selectEffort}
      />
    </footer>
  );
}
