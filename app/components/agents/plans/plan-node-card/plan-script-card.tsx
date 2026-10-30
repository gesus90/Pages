import { useTranslation } from "react-i18next";

import { planScriptParameters } from "@/definition/AgentPlanScript";

import { usePlanFlowContext } from "../plan-flow-context";
import { PlanNodeExecutionContext } from "../plan-node-execution-context";
import { PlanFlowPorts } from "../plan-flow-ports";
import {
  hasOpenPlanReport,
  PlanStatusBadge,
  isQueuedPlanStep,
  planStatusClass,
} from "../plan-status";
import { PlanAgentInput } from "./plan-agent-input";
import { PlanCard } from "./plan-card";
import { PlanResultOut } from "./plan-result-out";
import { PlanScriptProfile } from "./plan-script-profile";

import type { AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AgentPlanScript } from "@/definition/AgentPlanScript";

/**
 * A script with its flow IN and OUT, one row per declared input, its output
 * on the result port and its interpreter profile.
 *
 * @remarks
 * The card has the rows and size of an agent card (plan-layout.ts); only its
 * rose type color and the profile in place of model and reasoning differ.
 * Inputs bind like agent inputs. Local scripts inherit the plan workspace;
 * explicit remote targets stay visible while remote dispatch is unavailable.
 */
export function PlanScriptCard(props: {
  readonly script: AgentPlanScript;
  readonly result: AgentPlanStepResult | undefined;
  readonly hasRun: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  const { graph, canEdit, onEdit } = usePlanFlowContext();
  const { script, result } = props;
  const parameters = planScriptParameters(script);
  const status = result?.status ?? "waiting";
  function edit(): void {
    graph.select(script.id);
    onEdit?.(script.id);
  }
  return (
    <PlanCard
      node={script}
      label={script.name}
      title={script.name}
      subtitle={t("plans.nodeType.script")}
      runClass={
        props.hasRun
          ? planStatusClass(
              isQueuedPlanStep(result) ? "waiting" : status,
              result?.isBlocked,
              hasOpenPlanReport(result),
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
            hasOpenReport={hasOpenPlanReport(result)}
          />
        ) : null
      }
      onEdit={edit}
    >
      <div className="flex flex-col gap-1.5 px-3 pt-1 pb-2">
        <PlanFlowPorts
          node={script}
          graph={graph}
          canEdit={canEdit}
          isCompact
        />
        <PlanNodeExecutionContext script={script} />
        {parameters.length > 0 ? (
          <div
            role="group"
            aria-label={t("plans.inputsOf", { name: script.name })}
            className="flex flex-col gap-1.5"
          >
            {parameters.map((parameter) => (
              <PlanAgentInput
                key={parameter.name}
                step={script}
                label={script.name}
                parameter={parameter}
              />
            ))}
          </div>
        ) : null}
        {script.outputs[0] ? (
          <PlanResultOut nodeId={script.id} output={script.outputs[0].name} />
        ) : null}
      </div>
      <PlanScriptProfile script={script} />
    </PlanCard>
  );
}
