import { hasPlanGroupAliases } from "./AgentPlanGroup";
import { findPlanNodeLocation } from "./AgentPlanLoopEdit";

import type {
  AgentPlanBinding,
  AgentPlanInput,
  AgentPlanNode,
} from "./AgentPlan";

function referencesFrame(node: AgentPlanNode, frameId: string): boolean {
  if (node.type === "group" || node.type === "loop")
    return (
      Object.values(node.bindings).some((binding) =>
        references(binding, frameId),
      ) || node.steps.some((step) => referencesFrame(step, frameId))
    );
  if (node.type !== "agent" && node.type !== "script") return false;
  return Object.values(node.bindings).some((binding) =>
    references(binding, frameId),
  );
}

function references(binding: AgentPlanBinding, frameId: string): boolean {
  if (binding.kind === "source") return binding.nodeId === frameId;
  if (binding.kind === "result" || binding.kind === "previous")
    return binding.stepId === frameId;
  return false;
}

/** Whether dissolving a frame would replace edges or change existing input bindings. */
export function planFrameUngroupNeedsRepair(
  plan: AgentPlanInput,
  frameId: string,
): boolean {
  const frame = plan.nodes.find((node) => node.id === frameId);
  if (!frame || (frame.type !== "group" && frame.type !== "loop")) return false;
  if (plan.edges.some((edge) => edge.from === frameId || edge.to === frameId))
    return true;
  if (
    plan.nodes.some(
      (node) => node.id !== frameId && referencesFrame(node, frameId),
    )
  )
    return true;
  if (frame.type === "group")
    return (
      hasPlanGroupAliases(frame) ||
      frame.parameters.some((port) =>
        plan.nodes.some(
          (node) => node.id !== frameId && referencesFrame(node, port.id),
        ),
      )
    );
  return frame.steps.some((step) =>
    Object.values(step.bindings).some((binding) => binding.kind === "previous"),
  );
}

/** Whether a proposed membership move would remove a connection, binding or loop condition. */
export function planFrameMoveNeedsRepair(
  plan: AgentPlanInput,
  nodeId: string,
  targetId: string | null,
  result: { readonly removedEdges: number; readonly removedBindings: number },
): boolean {
  if (result.removedEdges > 0 || result.removedBindings > 0) return true;
  const location = findPlanNodeLocation(plan, nodeId);
  if (!location) return false;
  if (
    location.loop &&
    location.loop.id !== targetId &&
    location.loop.condition?.sourceNodeId === nodeId
  )
    return true;
  if (!location.group || location.group.id === targetId) return false;
  return Object.values(location.node.bindings).some(
    (binding) =>
      binding.kind === "source" &&
      location.group?.parameters.some((port) => port.id === binding.nodeId),
  );
}
