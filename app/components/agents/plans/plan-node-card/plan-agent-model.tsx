import { useTranslation } from "react-i18next";

import { Select } from "@/app/components/ui/select";
import { copyPlanConfiguration } from "@/definition/AgentPlanConfiguration";

import { usePlanFlowContext } from "../plan-flow-context";
import { planStepWithModel } from "../plan-node-configuration-fields";
import { PLAN_FIELD_CLASS } from "./plan-value-input";

import type { AgentPlanStep } from "@/definition/AgentPlan";
import type { AgentPlanConfiguration } from "@/definition/AgentPlanConfiguration";
import type { PageAgentModel } from "@/definition/PageAgent";

const FOOTER_CLASS =
  "grid h-12 shrink-0 grid-cols-2 items-center gap-2 border-t border-border px-3";

/**
 * Model and reasoning of an agent node, compact at the bottom of its card.
 *
 * @remarks
 * The lists offer only models the administrator released for this user,
 * and only those of the node's provider, so the card never switches the
 * provider; the node dialog keeps that choice. Without edit rights or
 * without a released model the card shows the effective values read only.
 */
export function PlanAgentModel(props: {
  readonly step: AgentPlanStep;
}): React.ReactElement {
  const { t } = useTranslation();
  const { sources, canEdit } = usePlanFlowContext();
  const { step } = props;
  const agent = sources.agents.find((entry) => entry.id === step.agentId);
  const configuration =
    step.configuration ?? (agent ? copyPlanConfiguration(agent) : null);
  if (!configuration)
    return (
      <footer className={FOOTER_CLASS}>
        <span className="col-span-2 truncate text-xs text-muted-foreground">
          {t("pageAgents.missingModel")}
        </span>
      </footer>
    );
  const models = (sources.models ?? []).filter(
    (entry) => entry.provider === configuration.provider,
  );
  const model = models.find(
    (entry) => entry.id === configuration.modelProfileId,
  );
  if (!canEdit || models.length === 0)
    return (
      <ModelValues
        model={model?.name ?? configuration.model}
        reasoning={configuration.reasoningEffort}
      />
    );
  return (
    <ModelChoice
      step={step}
      configuration={configuration}
      models={models}
      model={model}
    />
  );
}

/** The effective model and reasoning level, read only. */
function ModelValues(props: {
  readonly model: string;
  readonly reasoning: string | null;
}): React.ReactElement {
  const { t } = useTranslation();
  const reasoning = props.reasoning ?? t("pageAgents.defaultReasoning");
  return (
    <footer className={FOOTER_CLASS}>
      <p
        className="truncate text-xs"
        title={`${t("pageAgents.model")}: ${props.model}`}
      >
        <span className="sr-only">{t("pageAgents.model")}: </span>
        {props.model}
      </p>
      <p
        className="truncate text-xs"
        title={`${t("pageAgents.reasoning")}: ${reasoning}`}
      >
        <span className="sr-only">{t("pageAgents.reasoning")}: </span>
        {reasoning}
      </p>
    </footer>
  );
}

function ModelChoice(props: {
  readonly step: AgentPlanStep;
  readonly configuration: AgentPlanConfiguration;
  readonly models: readonly PageAgentModel[];
  readonly model: PageAgentModel | undefined;
}): React.ReactElement {
  const { t } = useTranslation();
  const { graph } = usePlanFlowContext();
  const { step, configuration, model } = props;
  const efforts = model?.reasoningEfforts ?? [];
  function selectModel(id: string): void {
    const selected = props.models.find((entry) => entry.id === id);
    if (selected)
      graph.replaceNode(
        planStepWithModel(
          step,
          configuration,
          selected,
          selected.reasoningEffort,
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
      <Select
        ariaLabel={t("pageAgents.model")}
        value={configuration.modelProfileId}
        className={`${PLAN_FIELD_CLASS} [&>span]:min-w-0 [&>span]:truncate`}
        options={[
          ...(model
            ? []
            : [
                {
                  value: configuration.modelProfileId,
                  label: t("pageAgents.missingModel"),
                  disabled: true,
                },
              ]),
          ...props.models.map((entry) => ({
            value: entry.id,
            label: entry.name,
            description: entry.model,
          })),
        ]}
        onValueChange={selectModel}
      />
      <Select
        ariaLabel={t("pageAgents.reasoning")}
        value={configuration.reasoningEffort ?? ""}
        disabled={efforts.length === 0}
        className={`${PLAN_FIELD_CLASS} [&>span]:min-w-0 [&>span]:truncate`}
        options={
          efforts.length > 0
            ? efforts.map((effort) => ({ value: effort, label: effort }))
            : [{ value: "", label: t("pageAgents.defaultReasoning") }]
        }
        onValueChange={selectEffort}
      />
    </footer>
  );
}
