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
  planRunCardClass,
} from "../plan-status";
import { PlanAgentInput } from "./plan-agent-input";
import { PlanAgentModel } from "./plan-agent-model";
import { PlanAgentEventIn, PlanAgentPassedOut } from "./plan-agent-branching";
import { PlanCard } from "./plan-card";
import { PlanResultOut } from "./plan-result-out";
import { PlanRunNotes } from "./plan-run-notes";
import { PlanAgentCurrentAsset } from "./plan-agent-current-asset";

import type {
  AgentPlanStep,
  AgentPlanStepResult,
} from "@/definition/AgentPlan";

/**
 * An agent with its flow IN and OUT, one row per input of its template, its
 * optional event IN, its boolean and its text result and its model.
 *
 * @remarks
 * Its height follows the number of inputs (plan-layout.ts). While a run of
 * the same revision is shown, the card takes the colors of its status and
 * notes a later start, its boolean result and the event that started it.
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
      runClass={props.hasRun ? planRunCardClass(result) : undefined}
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
        <PlanRunNotes result={result} />
        <PlanFlowPorts node={step} graph={graph} canEdit={canEdit} isCompact />
        <PlanAgentCurrentAsset step={step} />
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
        <PlanAgentEventIn step={step} label={label} />
        <PlanAgentPassedOut step={step} label={label} />
        <PlanResultOut nodeId={step.id} />
      </div>
      <PlanAgentModel step={step} />
    </PlanCard>
  );
}
