import { useId } from "react";
import { useTranslation } from "react-i18next";

import { ModelPicker } from "@/app/components/agents/model-picker";
import { ReasoningField } from "@/app/components/agents/model-picker/model-field";
import { Select } from "@/app/components/ui/select";
import { reasoningOptions } from "@/app/lib/reasoning-options";
import { PLAN_SWARM_ACCESS_MODES } from "@/definition/AgentPlanSwarm";

import {
  planSwarmModelId,
  planSwarmModelOf,
  planSwarmModelRefusal,
} from "./plan-swarm-form";

import type {
  AgentPlanSwarmAccess,
  AgentPlanSwarmModel,
} from "@/definition/AgentPlanSwarm";
import type { PageAgentModel } from "@/definition/PageAgent";

/** One model choice of a swarm: connection and model, reasoning and, for helpers, access. */
export interface PlanSwarmModelChoice {
  readonly model: AgentPlanSwarmModel | null;
  readonly access: AgentPlanSwarmAccess;
}

/** The access select of a helper or the main model. */
export function PlanSwarmAccessSelect(props: {
  readonly value: AgentPlanSwarmAccess;
  readonly isDisabled: boolean;
  readonly label: string;
  readonly onChange: (access: AgentPlanSwarmAccess) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const id = useId();
  return (
    <Select<AgentPlanSwarmAccess>
      id={id}
      size="sm"
      ariaLabel={props.label}
      value={props.value}
      disabled={props.isDisabled}
      options={PLAN_SWARM_ACCESS_MODES.map((access) => ({
        value: access,
        label: t(`plans.swarm.access.${access}`),
      }))}
      onValueChange={props.onChange}
    />
  );
}

/**
 * Connection, model, reasoning and access of the main model or of helpers.
 *
 * @remarks
 * The model picker lists every model Pages offers; a model without an ACP
 * connection stays listed, disabled with the reason, because each swarm
 * session is an ACP session of its own.
 */
export function PlanSwarmModelRow(props: {
  readonly label: string;
  readonly choice: PlanSwarmModelChoice;
  readonly models: readonly PageAgentModel[];
  readonly isDisabled: boolean;
  /** Shows only the model and access, as one compact row per helper. */
  readonly isCompact?: boolean;
  readonly onChange: (choice: PlanSwarmModelChoice) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const { choice, models } = props;
  const modelId = planSwarmModelId(choice.model, models);
  const catalog = models.find((entry) => entry.id === modelId);
  const efforts = reasoningOptions({
    model: catalog,
    modelName: catalog?.modelName ?? choice.model?.model ?? "",
    siblings: models,
    current: choice.model?.reasoningEffort ?? null,
    defaultLabel: t("pageAgents.defaultReasoning"),
    translate: t,
  });
  return (
    <div
      className={
        props.isCompact
          ? "grid min-w-0 grid-cols-[1fr_auto] gap-2"
          : "flex flex-col gap-2"
      }
    >
      <ModelPicker
        label={props.label}
        isLabelHidden={props.isCompact}
        value={modelId}
        models={models}
        disabled={props.isDisabled}
        placeholder={t("plans.swarm.chooseModel")}
        refusalOf={(model) =>
          planSwarmModelRefusal(model) ? t("plans.swarm.modelNotAcp") : null
        }
        onChange={(id) =>
          props.onChange({
            ...choice,
            model: planSwarmModelOf(id, models, choice.model),
          })
        }
      />
      {props.isCompact ? null : (
        <ReasoningField
          value={choice.model?.reasoningEffort ?? ""}
          options={efforts}
          disabled={props.isDisabled || !choice.model}
          onChange={(effort) =>
            choice.model &&
            props.onChange({
              ...choice,
              model: { ...choice.model, reasoningEffort: effort || null },
            })
          }
        />
      )}
      <PlanSwarmAccessSelect
        value={choice.access}
        label={t("plans.swarm.accessOf", { name: props.label })}
        isDisabled={props.isDisabled}
        onChange={(access) => props.onChange({ ...choice, access })}
      />
    </div>
  );
}
