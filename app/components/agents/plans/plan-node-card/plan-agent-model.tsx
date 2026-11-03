import { useTranslation } from "react-i18next";

import { ModelPicker } from "@/app/components/agents/model-picker";
import { Select } from "@/app/components/ui/select";
import { cn } from "@/app/lib/cn";
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
import { PLAN_NODE_TEXT } from "../plan-node-text";
import { PLAN_FIELD_CLASS } from "./plan-value-input";

import type { AgentPlanStep } from "@/definition/AgentPlan";
import type { AgentPlanConfiguration } from "@/definition/AgentPlanConfiguration";
import type { AgentPlanGroup } from "@/definition/AgentPlanGroup";
import type { PageAgentModel } from "@/definition/PageAgent";

const FOOTER_CLASS =
  "grid h-12 shrink-0 grid-cols-2 items-center gap-2 border-t border-border px-3";

/**
 * Model and reasoning of an agent node, compact at the bottom of its card.
 *
 * @remarks
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
  const { t } = useTranslation();
  const { sources, canEdit, draft } = usePlanFlowContext();
  const { step } = props;
  const agent = sources.agents.find((entry) => entry.id === step.agentId);
  const configuration =
    step.configuration ?? (agent ? copyPlanConfiguration(agent) : null);
  if (!configuration)
    return (
      <footer className={FOOTER_CLASS}>
        <span
          className={cn(
            "col-span-2 truncate text-muted-foreground",
            PLAN_NODE_TEXT.field,
          )}
        >
          {t("pageAgents.missingModel")}
        </span>
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
        model={model?.name ?? configuration.model}
        reasoning={configuration.reasoningEffort}
        isUnavailable={!model}
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
  readonly model: string;
  readonly reasoning: string | null;
  readonly isUnavailable: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  const reasoning = props.reasoning ?? t("pageAgents.defaultReasoning");
  return (
    <footer className={FOOTER_CLASS}>
      <p
        className={cn(
          "truncate",
          PLAN_NODE_TEXT.field,
          props.isUnavailable && "text-warning",
        )}
        title={`${t("pageAgents.model")}: ${props.model}${props.isUnavailable ? ` · ${t("pageAgents.missingModel")}` : ""}`}
      >
        <span className="sr-only">{t("pageAgents.model")}: </span>
        {props.isUnavailable ? (
          <span>{t("pageAgents.missingModel")} · </span>
        ) : null}
        {props.model}
      </p>
      <p
        className={cn("truncate", PLAN_NODE_TEXT.field)}
        title={`${t("pageAgents.reasoning")}: ${reasoning}`}
      >
        <span className="sr-only">{t("pageAgents.reasoning")}: </span>
        {reasoning}
      </p>
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
        size="compact"
        refusalOf={refusalOf}
        triggerClassName={PLAN_FIELD_CLASS}
        onChange={selectModel}
      />
      <Select
        ariaLabel={t("pageAgents.reasoning")}
        value={configuration.reasoningEffort ?? ""}
        disabled={effortOptions.length === 1}
        className={`${PLAN_FIELD_CLASS} [&>span]:min-w-0 [&>span]:truncate`}
        options={effortOptions}
        onValueChange={selectEffort}
      />
    </footer>
  );
}
