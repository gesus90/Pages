import { useUpdateNodeInternals } from "@xyflow/react";
import { useEffect } from "react";

import { planNodeParameters } from "@/definition/AgentPlanGroup";

import type { AgentPlanNode, AgentPlanSources } from "@/definition/AgentPlan";

/** Re-measures renamed or replaced handles even when the node keeps the same size. */
export function usePlanFlowPorts(
  node: AgentPlanNode,
  sources: AgentPlanSources,
): void {
  const update = useUpdateNodeInternals();
  const id = node.id;
  const ports = JSON.stringify({
    inputs: planNodeParameters(node, sources.agents).map((port) => port.name),
    outputs:
      node.type === "group" ? node.parameters.map((port) => port.id) : [],
  });
  useEffect(() => {
    update(id);
  }, [id, ports, update]);
}
