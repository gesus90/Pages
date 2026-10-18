import { usePlanFlowContext } from "./plan-flow-context";
import { PlanEndpoint } from "./plan-endpoint";
import { PlanGroupFrame } from "./plan-group-frame";
import { planRunGroupSession } from "./plan-group-session";
import { PlanAgentCard } from "./plan-node-card/plan-agent-card";
import { PlanSourceCard } from "./plan-node-card/plan-source-card";
import { usePlanFlowPorts } from "./use-plan-flow-ports";

import type { NodeProps } from "@xyflow/react";
import type { PlanFlowNode } from "./plan-flow-model";

/**
 * Custom React Flow cards retain the Pages instance, ports and recorded run states.
 *
 * @remarks
 * One card family: compact start and end, parameter and ticket cards of
 * medium size and agent cards as tall as their inputs. Frames keep their
 * own design.
 */
export function PlanNodeCard({
  data: { node },
}: NodeProps<PlanFlowNode>): React.ReactElement {
  const context = usePlanFlowContext();
  const { sources, graph, canEdit, run } = context;
  usePlanFlowPorts(node, sources);
  const result = run?.steps.find((step) => step.id === node.id);
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
        result={result}
        hasRun={run !== null}
      />
    );
  if (node.type === "agent")
    return <PlanAgentCard step={node} result={result} hasRun={run !== null} />;
  return <PlanSourceCard node={node} />;
}
