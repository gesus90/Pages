import { useTranslation } from "react-i18next";

import { planNodeParameters } from "@/definition/AgentPlanGroup";

import { usePlanFlowContext } from "../plan-flow-context";
import { PlanNodeExecutionContext } from "../plan-node-execution-context";
import { PlanFlowPorts } from "../plan-flow-ports";
import { planAgentName } from "../plan-layout";
import {
  hasOpenPlanReport,
  PlanStatusBadge,
  isQueuedPlanStep,
  planStatusClass,
} from "../plan-status";
import { PlanAgentInput } from "./plan-agent-input";
import { PlanAgentModel } from "./plan-agent-model";
import { PlanCard } from "./plan-card";
import { PlanResultOut } from "./plan-result-out";

import type {
  AgentPlanStep,
  AgentPlanStepResult,
} from "@/definition/AgentPlan";

/**
 * An agent with its flow IN and OUT, one row per input of its template, its
 * result OUT and its model.
 *
 * @remarks
 * Its height follows the number of inputs (plan-layout.ts). While a run of
 * the same revision is shown, the card takes the colors of its status.
 */
export function PlanAgentCard(props: {
  readonly step: AgentPlanStep;
  readonly result: AgentPlanStepResult | undefined;
  readonly hasRun: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  const { sources, graph, canEdit, onEdit } = usePlanFlowContext();
  const { step, result } = props;
  const label = planAgentName(step, sources) || t("plans.missingAgent");
  const parameters = planNodeParameters(step, sources.agents);
  const status = result?.status ?? "waiting";
  const hasOpenReport = hasOpenPlanReport(result);
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
      runClass={
        props.hasRun
          ? planStatusClass(
              isQueuedPlanStep(result) ? "waiting" : status,
              result?.isBlocked,
              hasOpenReport,
            )
          : undefined
      }
      status={
        props.hasRun ? (
          <PlanStatusBadge
            isQueued={isQueuedPlanStep(result)}
            compact
            status={status}
            isBlocked={result?.isBlocked}
            hasOpenReport={hasOpenReport}
          />
        ) : null
      }
      onEdit={edit}
    >
      <div className="flex flex-col gap-1.5 px-3 pt-1 pb-2">
        <PlanFlowPorts node={step} graph={graph} canEdit={canEdit} isCompact />
        <PlanNodeExecutionContext step={step} />
        {parameters.length > 0 ? (
          <div
            role="group"
            aria-label={t("plans.inputsOf", { name: label })}
            className="flex flex-col gap-1.5"
          >
            {parameters.map((parameter) => (
              <PlanAgentInput
                key={parameter.name}
                step={step}
                label={label}
                parameter={parameter}
              />
            ))}
          </div>
        ) : null}
        <PlanResultOut nodeId={step.id} />
      </div>
      <PlanAgentModel step={step} />
    </PlanCard>
  );
}
