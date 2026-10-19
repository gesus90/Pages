import { useTranslation } from "react-i18next";

import { Select } from "@/app/components/ui/select";
import { cn } from "@/app/lib/cn";
import {
  planMemberProviderRefusal,
  planStepProvider,
} from "@/definition/AgentPlanGroup";
import { findPlanStep } from "@/definition/AgentPlanGroupEdit";
import { copyPlanConfiguration } from "@/definition/AgentPlanConfiguration";

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
 * The list offers every model the administrator released to the user for
 * the plan's project, of any provider. Choosing one pins its model profile,
 * model, provider and the model's own reasoning default on this node only;
 * other nodes and the agent template stay as they are. A member of an ACP
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
  const models = sources.models ?? [];
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
      group={findPlanStep(draft, step.id)?.group ?? null}
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
        className={cn("truncate", PLAN_NODE_TEXT.field)}
        title={`${t("pageAgents.model")}: ${props.model}`}
      >
        <span className="sr-only">{t("pageAgents.model")}: </span>
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
 * The choices of the model list: runner and model id tell equal names apart.
 *
 * @remarks
 * A model the node's group cannot share stays visible, disabled, with the
 * reason and the way to choose it.
 */
function useModelOptions(input: {
  readonly step: AgentPlanStep;
  readonly models: readonly PageAgentModel[];
  readonly group: AgentPlanGroup | null;
}): readonly {
  readonly value: string;
  readonly label: string;
  readonly description: string;
  readonly disabled: boolean;
}[] {
  const { t } = useTranslation();
  const { sources } = usePlanFlowContext();
  const { group } = input;
  const adapter = group?.steps
    .filter((member) => member.id !== input.step.id)
    .map((member) => planStepProvider(member, sources.agents))
    .find((provider) => provider !== null);
  return input.models.map((entry) => {
    const refusal = group
      ? planMemberProviderRefusal(
          group,
          input.step.id,
          entry.provider,
          sources.agents,
        )
      : null;
    const runner = t(`settings.agents.providerShort.${entry.provider}`);
    return {
      value: entry.id,
      label: entry.name,
      description: refusal
        ? t(`plans.modelRefusal.${refusal}`, {
            runner,
            adapter: adapter
              ? t(`settings.agents.providerShort.${adapter}`)
              : "",
          })
        : `${runner} · ${entry.model}`,
      disabled: refusal !== null,
    };
  });
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
  const options = useModelOptions(props);
  const efforts = model?.reasoningEfforts ?? [];
  function selectModel(id: string): void {
    const selected = props.models.find((entry) => entry.id === id);
    // The model's own default is a level it knows; an earlier one may not be.
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
          ...options,
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
