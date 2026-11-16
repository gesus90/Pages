import { useId } from "react";
import { useTranslation } from "react-i18next";

import { ModelPicker } from "@/app/components/agents/model-picker";
import { SegmentedControl } from "@/app/components/ui/segmented-control";
import { Textarea } from "@/app/components/ui/textarea";
import { Button } from "@/app/components/ui/button";
import { PLAN_DECISION_QUESTION_LENGTH } from "@/definition/AgentPlanDecision";

import { PlanDecisionCases } from "./plan-decision-cases";

import type { AgentPlanDecisionOutput } from "@/definition/AgentPlanDecision";
import type { PageAgentModel } from "@/definition/PageAgent";
import type { PlanDecisionForm } from "./plan-decision-form";

/**
 * The choice of the decision model, with the way back to the decision model of the instance.
 * @remarks
 * Only decision models are listed, by name and provider, without a reasoning
 * level, which decision models do not have. Without a choice the decision
 * asks the decision model of the instance, which the empty choice names.
 */
function DecisionModelChoice(props: {
  readonly form: PlanDecisionForm;
  readonly models: readonly PageAgentModel[];
  readonly defaultModel: string | null;
  readonly isDisabled: boolean;
  readonly onChange: (form: PlanDecisionForm) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const { form } = props;
  return (
    <div className="space-y-1 text-sm">
      <ModelPicker
        consumer="decision"
        label={t("plans.decision.dialog.model")}
        value={form.modelId}
        models={props.models}
        disabled={props.isDisabled}
        placeholder={
          props.defaultModel === null
            ? t("plans.decision.dialog.noDefaultModel")
            : t("plans.decision.dialog.defaultModel", {
                model: props.defaultModel,
              })
        }
        emptyLabel={t("plans.decision.dialog.noDecisionModels")}
        onChange={(modelId) => props.onChange({ ...form, modelId })}
      />
      {form.modelId === "" ? null : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={props.isDisabled}
          onClick={() => props.onChange({ ...form, modelId: "" })}
        >
          {t("plans.decision.dialog.useDefaultModel")}
        </Button>
      )}
    </div>
  );
}

/**
 * The settings of a model decision: its question, its decision model and what it answers.
 */
export function PlanDecisionModelFields(props: {
  readonly form: PlanDecisionForm;
  readonly models: readonly PageAgentModel[];
  /** The name of the decision model of the instance; `null` while none is set. */
  readonly defaultModel: string | null;
  readonly isDisabled: boolean;
  readonly isCaseConnected: (caseId: string) => boolean;
  readonly onChange: (form: PlanDecisionForm) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const questionId = useId();
  const { form } = props;
  return (
    <div className="space-y-4" data-plan-decision-model>
      <label htmlFor={questionId} className="block space-y-1 text-sm">
        <span>{t("plans.decision.dialog.question")}</span>
        <Textarea
          id={questionId}
          value={form.question}
          rows={3}
          maxLength={PLAN_DECISION_QUESTION_LENGTH}
          placeholder={t("plans.decision.dialog.questionPlaceholder")}
          disabled={props.isDisabled}
          onChange={(event) =>
            props.onChange({ ...form, question: event.target.value })
          }
        />
      </label>
      <DecisionModelChoice
        form={form}
        models={props.models}
        defaultModel={props.defaultModel}
        isDisabled={props.isDisabled}
        onChange={props.onChange}
      />
      <div className="space-y-1 text-sm">
        <span className="block">{t("plans.decision.dialog.output")}</span>
        <SegmentedControl<AgentPlanDecisionOutput>
          ariaLabel={t("plans.decision.dialog.output")}
          value={form.output}
          options={[
            { value: "boolean", label: t("plans.decision.dialog.yesNo") },
            {
              value: "classification",
              label: t("plans.decision.dialog.classification"),
            },
          ]}
          onValueChange={(output) => {
            if (!props.isDisabled) props.onChange({ ...form, output });
          }}
        />
      </div>
      {form.output === "classification" ? (
        <PlanDecisionCases
          cases={form.cases}
          isDisabled={props.isDisabled}
          isConnected={props.isCaseConnected}
          onChange={(cases) => props.onChange({ ...form, cases })}
        />
      ) : null}
    </div>
  );
}
