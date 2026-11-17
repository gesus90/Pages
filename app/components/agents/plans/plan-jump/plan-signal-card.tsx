import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { usePlanFlowContext } from "../plan-flow-context";
import { PLAN_NODE_TEXT } from "../plan-node-text";
import { PlanCard } from "../plan-node-card/plan-card";
import { planRunCardClass } from "../plan-status";
import { PlanRunBadge } from "./plan-jump-card";
import { planJumpPorts } from "./plan-jump-model";
import { PlanPortGrid } from "./plan-jump-ports";
import { firstFilledText } from "./plan-jump-text";
import { PlanSignalRunLine } from "./plan-signal-run";

import type { AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AgentPlanSignal } from "@/definition/AgentPlanJump";

/**
 * The signal node: an intermediate message to the caller of the run.
 * @remarks
 * The receiver is always the caller; a run without a caller continues without
 * delivery. With a payload type the card has one value input for it.
 */
export function PlanSignalCard(props: {
  readonly signal: AgentPlanSignal;
  readonly result: AgentPlanStepResult | undefined;
  readonly hasRun: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  const { draft, graph, onEdit } = usePlanFlowContext();
  const { signal, result } = props;
  const label = firstFilledText(signal.name) || t("plans.signal.title");
  function edit(): void {
    graph.select(signal.id);
    onEdit?.(signal.id);
  }
  return (
    <PlanCard
      node={signal}
      label={label}
      title={t("plans.signal.title")}
      subtitle={t("plans.signal.caption")}
      runClass={props.hasRun ? planRunCardClass(result) : undefined}
      status={<PlanRunBadge hasRun={props.hasRun} result={result} />}
      onEdit={edit}
    >
      <div
        data-plan-signal={signal.id}
        className="flex flex-col gap-1.5 px-3 pt-1 pb-2"
      >
        <p
          title={signal.signalName}
          className={cn(
            "truncate font-mono font-medium text-foreground",
            PLAN_NODE_TEXT.field,
          )}
        >
          {signal.signalName}
        </p>
        {props.hasRun && result?.signal ? (
          <PlanSignalRunLine signal={result.signal} />
        ) : null}
        <PlanPortGrid
          nodeId={signal.id}
          label={label}
          ports={planJumpPorts(draft, signal)}
          bindings={signal.bindings}
        />
      </div>
    </PlanCard>
  );
}
