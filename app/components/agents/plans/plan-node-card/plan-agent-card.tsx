import { CircleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";

import { planStepSelection } from "@/definition/AgentPlanSelection";
import { planNodeParameters } from "@/definition/AgentPlanGroup";
import { planProfileProblem } from "@/definition/AgentPlanProfile";

import { usePlanFlowContext } from "../plan-flow-context";
import { PlanNodeExecutionContext } from "../plan-node-execution-context";
import { planAgentName } from "../plan-layout";
import { PlanRunMarker, planRunCardClass } from "../plan-status";
import { PlanAccessNotice } from "../plan-access-notice";
import { PlanAgentInput } from "./plan-agent-input";
import { PlanAgentModel } from "./plan-agent-model";
import {
  PlanAgentEventChip,
  PlanAgentEventIn,
  PlanAgentPassedOut,
} from "./plan-agent-branching";
import { PlanCard, PlanCardColumns, PLAN_CARD_BODY } from "./plan-card";
import { PlanResultOut } from "./plan-result-out";
import { PlanRunNotes } from "./plan-run-notes";
import { PlanAgentCurrentAsset } from "./plan-agent-current-asset";

import type {
  AgentPlanStep,
  AgentPlanStepResult,
} from "@/definition/AgentPlan";

/** The notes above the rows of an agent: problems of its profile and selection, its access and its run. */
function AgentNotes(props: {
  readonly step: AgentPlanStep;
  readonly result: AgentPlanStepResult | undefined;
}): React.ReactElement {
  const { t } = useTranslation();
  const { sources } = usePlanFlowContext();
  const { step } = props;
  const profileProblem = planProfileProblem(step, sources.agents);
  const selection = planStepSelection(step);
  return (
    <>
      {profileProblem ? (
        <p
          role="alert"
          className="flex items-center gap-1 text-xs text-primary"
        >
          <CircleAlert aria-hidden="true" className="size-3 shrink-0" />
          {t(`plans.validation.${profileProblem}`)}
        </p>
      ) : null}
      {selection ? (
        <p className="flex items-center gap-1 text-xs font-medium text-primary">
          <CircleAlert aria-hidden="true" className="size-3" />
          {t(`plans.manage.select.${selection}`)}
        </p>
      ) : null}
      <PlanAccessNotice access={step.configuration?.template.run?.access} />
      <PlanRunNotes result={props.result} />
      <PlanAgentCurrentAsset step={step} />
    </>
  );
}

/**
 * An agent with its flow dots, one row per input of its template and its
 * optional event IN on the left, its text and its boolean result on the
 * right, its execution place and its model.
 * @remarks
 * Its height follows the number of inputs (plan-layout.ts). While a run of
 * the same revision is shown, the status marker names its status and the
 * card notes a later start, its boolean result and the event that started
 * it; the card itself keeps its type colors.
 */
export function PlanAgentCard(props: {
  readonly step: AgentPlanStep;
  readonly result: AgentPlanStepResult | undefined;
  readonly hasRun: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  const { sources, graph, onEdit } = usePlanFlowContext();
  const { step, result } = props;
  const label = planAgentName(step, sources) || t("plans.missingAgent");
  const parameters = planNodeParameters(step, sources.agents);
  function edit(): void {
    graph.select(step.id);
    onEdit?.(step.id);
  }
  return (
    <PlanCard
      node={step}
      label={label}
      title={label}
      subtitle={t("plans.nodeType.agent")}
      stateClass={props.hasRun ? planRunCardClass(result) : undefined}
      status={<PlanRunMarker hasRun={props.hasRun} result={result} />}
      onEdit={edit}
    >
      <div className={PLAN_CARD_BODY}>
        <AgentNotes step={step} result={result} />
        <PlanCardColumns
          label={t("plans.inputsOf", { name: label })}
          inputs={
            <>
              {parameters.map((parameter) => (
                <PlanAgentInput
                  key={parameter.name}
                  step={step}
                  label={label}
                  parameter={parameter}
                />
              ))}
              <PlanAgentEventIn step={step} label={label} />
            </>
          }
          outputs={
            <>
              <PlanResultOut nodeId={step.id} />
              <PlanAgentPassedOut step={step} label={label} />
            </>
          }
        />
        <PlanAgentEventChip step={step} />
      </div>
      <PlanNodeExecutionContext step={step} />
      <PlanAgentModel step={step} />
    </PlanCard>
  );
}
