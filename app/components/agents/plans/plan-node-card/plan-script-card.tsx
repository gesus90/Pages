import { useTranslation } from "react-i18next";

import { planScriptParameters } from "@/definition/AgentPlanScript";

import { usePlanFlowContext } from "../plan-flow-context";
import { PlanNodeExecutionContext } from "../plan-node-execution-context";
import { PlanRunMarker, planRunCardClass } from "../plan-status";
import { PlanAgentInput } from "./plan-agent-input";
import { PlanCard, PlanCardColumns, PLAN_CARD_BODY } from "./plan-card";
import { PlanResultOut } from "./plan-result-out";
import { PlanRunNotes } from "./plan-run-notes";
import { PlanScriptProfile } from "./plan-script-profile";

import type { AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AgentPlanScript } from "@/definition/AgentPlanScript";

/**
 * A script with its flow dots, one row per declared input on the left, its
 * output on the right, its execution place and its interpreter profile.
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
  const { graph, onEdit } = usePlanFlowContext();
  const { script, result } = props;
  const parameters = planScriptParameters(script);
  function edit(): void {
    graph.select(script.id);
    onEdit?.(script.id);
  }
  return (
    <PlanCard
      node={script}
      label={script.name}
      title={script.name}
      subtitle={
        script.disabled
          ? `${t("plans.nodeType.script")} · ${t("plans.scripts.disabled")}`
          : t("plans.nodeType.script")
      }
      isDimmed={script.disabled === true}
      stateClass={props.hasRun ? planRunCardClass(result) : undefined}
      status={<PlanRunMarker hasRun={props.hasRun} result={result} />}
      onEdit={edit}
    >
      <div className={PLAN_CARD_BODY}>
        <PlanRunNotes result={result} />
        <PlanCardColumns
          label={t("plans.inputsOf", { name: script.name })}
          inputs={parameters.map((parameter) => (
            <PlanAgentInput
              key={parameter.name}
              step={script}
              label={script.name}
              parameter={parameter}
            />
          ))}
          outputs={
            script.outputs[0] ? (
              <PlanResultOut
                nodeId={script.id}
                output={script.outputs[0].name}
              />
            ) : null
          }
        />
      </div>
      <PlanNodeExecutionContext script={script} />
      <PlanScriptProfile script={script} />
    </PlanCard>
  );
}
