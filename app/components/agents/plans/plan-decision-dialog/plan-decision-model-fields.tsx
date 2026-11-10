import { useId } from "react";
import { useTranslation } from "react-i18next";

import { ModelPicker } from "@/app/components/agents/model-picker";
import { SegmentedControl } from "@/app/components/ui/segmented-control";
import { Textarea } from "@/app/components/ui/textarea";
import { PLAN_DECISION_QUESTION_LENGTH } from "@/definition/AgentPlanDecision";

import { PlanDecisionCases } from "./plan-decision-cases";
import { planDecisionModelRefusal } from "./plan-decision-form";

import type { AgentPlanDecisionOutput } from "@/definition/AgentPlanDecision";
import type { PageAgentModel } from "@/definition/PageAgent";
import type { PlanDecisionForm } from "./plan-decision-form";

/**
 * The settings of a model decision: its question, its model and what it answers.
 *
 * @remarks
 * The model choice is the model picker of agent nodes with every model Pages
 * offers; a model that runs over no ACP connection stays listed, disabled
 * with the reason, because a decision runs its own ACP session.
 */
export function PlanDecisionModelFields(props: {
  readonly form: PlanDecisionForm;
  readonly models: readonly PageAgentModel[];
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
      <div className="space-y-1 text-sm">
        <ModelPicker
          label={t("plans.decision.dialog.model")}
          value={form.modelId}
          models={props.models}
          disabled={props.isDisabled}
          placeholder={t("plans.decision.dialog.chooseModel")}
          refusalOf={(model) =>
            planDecisionModelRefusal(model)
              ? t("plans.decision.dialog.modelNotAcp")
              : null
          }
          onChange={(modelId) => props.onChange({ ...form, modelId })}
        />
      </div>
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
