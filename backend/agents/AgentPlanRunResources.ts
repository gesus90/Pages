import { readPlanText } from "./AgentPlanInput";
import { readAgentObject } from "./AgentPayload";

/** Live read checks use identifiers from the private snapshot, never copied resource content. */
export interface AgentPlanRunResources {
  readonly projectId: string;
  readonly workspaceIds: readonly string[];
  readonly taskIds: readonly string[];
  readonly wikiIds: readonly string[];
  readonly agentIds: readonly string[];
}

/** Extracts only resource identifiers needed to reauthorize output disclosure. */
export function readPlanRunResources(input: unknown): AgentPlanRunResources {
  const snapshot = readAgentObject(input);
  const plan = readAgentObject(snapshot.plan);
  const workspaceIds = new Set<string>([readPlanText(plan.workspaceId)]);
  const taskIds = new Set<string>();
  const wikiIds = new Set<string>();
  const agentIds = new Set<string>();
  const nodes: readonly unknown[] = Array.isArray(plan.nodes) ? plan.nodes : [];
  for (const inputNode of nodes) {
    const node = readAgentObject(inputNode);
    if (node.type === "task") taskIds.add(readPlanText(node.taskId));
    if (node.type === "agent") agentIds.add(readPlanText(node.agentId));
  }
  const steps: readonly unknown[] = Array.isArray(snapshot.steps)
    ? snapshot.steps
    : [];
  for (const inputStep of steps) {
    const step = readAgentObject(inputStep);
    const prepared = readAgentObject(step.prepared);
    const parameters = readAgentObject(prepared.parameters);
    const values = readAgentObject(parameters.values);
    const ids: readonly unknown[] = Array.isArray(step.taskIds)
      ? step.taskIds
      : [];
    for (const id of ids) taskIds.add(readPlanText(id));
    for (const inputValue of Object.values(values)) {
      if (inputValue === null) continue;
      const value = readAgentObject(inputValue);
      if (value.type === "workspace")
        workspaceIds.add(readPlanText(value.workspaceId));
      if (value.type === "wiki") wikiIds.add(readPlanText(value.pageId));
    }
  }
  return {
    projectId: readPlanText(plan.projectId),
    workspaceIds: [...workspaceIds],
    taskIds: [...taskIds],
    wikiIds: [...wikiIds],
    agentIds: [...agentIds],
  };
}
