import { usePlanFlowContext } from "./plan-flow-context";
import { PlanEndpoint } from "./plan-endpoint";
import { PlanGroupFrame } from "./plan-group-frame";
import { PlanLoopFrame } from "./plan-loop-frame";
import { planLoopMemberResult } from "./plan-loop-summary";
import { planRunGroupSession } from "./plan-group-session";
import { PlanAgentCard } from "./plan-node-card/plan-agent-card";
import { PlanDecisionCard } from "./plan-node-card/plan-decision-card";
import { PlanScriptCard } from "./plan-node-card/plan-script-card";
import { PlanStackCard } from "./plan-node-card/plan-stack-card";
import { PlanSourceCard } from "./plan-node-card/plan-source-card";
import { planPortLayout, usePlanFlowPorts } from "./use-plan-flow-ports";

import type { NodeProps } from "@xyflow/react";
import type { PlanFlowNode } from "./plan-flow-model";

/**
 * Custom React Flow cards retain the Pages instance, ports and recorded run states.
 *
 * @remarks
 * One card family: compact start and end, parameter, ticket and decision
 * cards of medium size and agent and script cards as tall as their inputs.
 * Frames keep their own design.
 */
export function PlanNodeCard({
  data: { node },
}: NodeProps<PlanFlowNode>): React.ReactElement {
  const context = usePlanFlowContext();
  const { sources, graph, canEdit, run } = context;
  const result =
    run?.steps.find((step) => step.id === node.id) ??
    planLoopMemberResult(run, node.id);
  usePlanFlowPorts(node, sources, planPortLayout(context.draft, node, result));
  if (node.type === "start" || node.type === "end")
    return (
      <PlanEndpoint
        node={node}
        graph={graph}
        canEdit={canEdit}
        hasRun={run !== null}
        result={result}
      />
    );
  if (node.type === "group")
    return (
      <PlanGroupFrame
        {...context}
        group={node}
        isDropTarget={context.dropTarget === node.id}
        session={planRunGroupSession(run, node.id)}
        isCollapsed={context.collapsedGroups.has(node.id)}
        onToggle={() => context.toggleGroup(node.id)}
        onSaveTemplate={context.requestTemplate}
      />
    );
  if (node.type === "loop")
    return (
      <PlanLoopFrame
        {...context}
        loop={node}
        isDropTarget={context.dropTarget === node.id}
      />
    );
  if (node.type === "agent")
    return <PlanAgentCard step={node} result={result} hasRun={run !== null} />;
  if (node.type === "script")
    return (
      <PlanScriptCard script={node} result={result} hasRun={run !== null} />
    );
  if (node.type === "decision")
    return (
      <PlanDecisionCard decision={node} result={result} hasRun={run !== null} />
    );
  if (node.type === "stack")
    return (
      <PlanStackCard
        stack={node}
        hasRun={run !== null}
        isDropTarget={context.dropTarget === node.id}
      />
    );
  return <PlanSourceCard node={node} />;
}
