import { useTranslation } from "react-i18next";

import { ModelPicker } from "@/app/components/agents/model-picker";
import {
  findModelChoice,
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
 * The footer: 48 px high, 12 px padding, two equally wide columns 8 px
 * apart, so a field is 143 px wide on a 320 px card and 138 px on the
 * narrowest 310 px card, whatever it shows.
 */
const FOOTER_CLASS =
  "grid h-12 shrink-0 grid-cols-2 items-center gap-2 border-t border-border px-3";

/**
 * Model and reasoning of an agent node at the bottom of its card, each as a
 * badge in a fixed field.
 * @remarks
 * Both fields are 40 px high and equally wide; the badge stands left and is
 * cut with an ellipsis when its name is too long, the arrow stays at the
 * right edge. Choosing another model or level changes only the badge, never
 * a field, an arrow or the footer.
 * The list offers known models of connections currently shared with the person.
 * Choosing one pins its connection, model and provider on this node only;
 * instructions, bindings, reasoning and run options stay as they are. A member of an ACP
 * group shares the group's session, which never spans runners, so models of
 * another runner stay listed but disabled, naming the way out: drag the
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
        <PlanReasoningValue reasoning={null} hasLevels={false} />
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
  readonly reasoning: string | null;
}): React.ReactElement {
  const { t } = useTranslation();
  const { model } = props;
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
            ? { mark: selected.group.mark, name: selected.choice.label }
            : null
        }
        savedModel={props.savedModel}
      />
      <PlanReasoningValue
        reasoning={props.reasoning}
        hasLevels={(model?.reasoningEfforts ?? []).length > 0}
      />
    </footer>
  );
}

/**
 * Why a model cannot join the node's group: models of another runner stay
 * listed but disabled, naming the reason and the way to choose them.
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
        disabled={false}
        isLabelHidden
        mode="floating"
        valueStyle="badge"
        refusalOf={refusalOf}
        onChange={selectModel}
      />
      <PlanReasoningField
        value={configuration.reasoningEffort ?? ""}
        options={effortOptions}
        onChange={selectEffort}
      />
    </footer>
  );
}
