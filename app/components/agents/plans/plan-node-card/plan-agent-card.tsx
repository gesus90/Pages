import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { cn } from "@/app/lib/cn";
import { planNodeParameters } from "@/definition/AgentPlanGroup";

import { usePlanFlowContext } from "../plan-flow-context";
import { PlanFlowHandle } from "../plan-flow-handle";
import { PlanFlowPorts } from "../plan-flow-ports";
import { planAgentName } from "../plan-layout";
import { PLAN_NODE_TEXT } from "../plan-node-text";
import { PlanStatusBadge, planStatusClass } from "../plan-status";
import { PlanAgentInput } from "./plan-agent-input";
import { PlanAgentModel } from "./plan-agent-model";
import { PlanCard } from "./plan-card";

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
        props.hasRun ? planStatusClass(status, result?.isBlocked) : undefined
      }
      status={
        props.hasRun ? (
          <PlanStatusBadge
            compact
            status={status}
            isBlocked={result?.isBlocked}
          />
        ) : null
      }
      onEdit={edit}
    >
      <div className="flex flex-col gap-1.5 px-3 pt-1 pb-2">
        <PlanFlowPorts node={step} graph={graph} canEdit={canEdit} isCompact />
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
        <ResultOut step={step} />
      </div>
      <PlanAgentModel step={step} />
    </PlanCard>
  );
}

/** The violet data OUT that hands the agent's result to a later agent. */
function ResultOut(props: {
  readonly step: AgentPlanStep;
}): React.ReactElement {
  const { t } = useTranslation();
  const { graph, canEdit } = usePlanFlowContext();
  const isActive =
    graph.connection?.nodeId === props.step.id &&
    graph.connection.kind === "result";
  return (
    <div className="relative flex h-7 items-center justify-end">
      <Button
        size="xs"
        variant="ghost"
        aria-label={t("plans.resultOut")}
        className={cn(
          "nodrag nopan -mr-1.25 h-7 min-h-7 cursor-crosshair border border-transparent px-1 font-medium hover:bg-surface/70 xl:min-h-7 xl:px-1 xl:text-xs",
          PLAN_NODE_TEXT.field,
          isActive && "text-primary",
        )}
        disabled={!canEdit}
        onClick={() => graph.begin({ kind: "result", nodeId: props.step.id })}
      >
        {t("plans.resultShort")}
      </Button>
      <PlanFlowHandle id="value-out" type="source" kind="data" />
    </div>
  );
}
