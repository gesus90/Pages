import { planExecutionTargetSchema } from "@/definition/AgentPlanExecution";

import { readPlanText } from "./AgentPlanInput";
import { readAgentObject } from "./AgentPayload";
import type { AgentPlanExecutionTarget } from "@/definition/AgentPlanExecution";
import type { AgentTicketAsset } from "@/definition/AgentTicketParameter";

/** Live read checks use identifiers from the private snapshot, never copied resource content. */
export interface AgentPlanRunResources {
  readonly remoteWorkspaceIds?: readonly string[];
  /** The plan target the run started with; absent for the Pages host and older runs. */
  readonly executionTarget?: AgentPlanExecutionTarget;
  readonly projectId: string;
  readonly workspaceIds: readonly string[];
  readonly taskIds: readonly string[];
  readonly wikiIds: readonly string[];
  readonly ticketIds: readonly string[];
  readonly agentIds: readonly string[];
  readonly connectionIds?: readonly string[];
  readonly ticketAssets?: readonly AgentTicketAsset[];
}

function readTicketAssets(
  parameters: Record<string, unknown>,
): readonly AgentTicketAsset[] {
  const assets: AgentTicketAsset[] = [];
  const inputs: readonly unknown[] = Array.isArray(parameters.assetInputs)
    ? parameters.assetInputs
    : [];
  for (const input of inputs) {
    const ticket = readAgentObject(readAgentObject(input).ticket);
    const references: readonly unknown[] = Array.isArray(ticket.assets)
      ? ticket.assets
      : [];
    for (const reference of references) {
      const asset = readAgentObject(reference);
      if (
        asset.source !== "ticket" &&
        asset.source !== "wiki" &&
        asset.source !== "agent"
      )
        throw new Error("Invalid stored ticket asset source");
      assets.push({
        source: asset.source,
        id: readPlanText(asset.id),
        link: readPlanText(asset.link),
      });
    }
  }
  return assets;
}

/** Extracts only resource identifiers needed to reauthorize output disclosure. */
export function readPlanRunResources(input: unknown): AgentPlanRunResources {
  const snapshot = readAgentObject(input);
  const plan = readAgentObject(snapshot.plan);
  const workspaceIds = new Set<string>([readPlanText(plan.workspaceId)]);
  const taskIds = new Set<string>();
  const wikiIds = new Set<string>();
  const ticketIds = new Set<string>();
  const agentIds = new Set<string>();
  const connectionIds = new Set<string>();
  const ticketAssets = new Map<string, AgentTicketAsset>();
  const nodes: readonly unknown[] = Array.isArray(plan.nodes) ? plan.nodes : [];
  for (const inputNode of nodes) {
    const node = readAgentObject(inputNode);
    if (node.type === "task") taskIds.add(readPlanText(node.taskId));
    if (node.type === "agent")
      addModelReference(node, { agentIds, connectionIds });
  }
  const steps: readonly unknown[] = Array.isArray(snapshot.steps)
    ? snapshot.steps
    : [];
  for (const inputStep of steps) {
    const step = readAgentObject(inputStep);
    addStepModelReference(step, { agentIds, connectionIds });
    const prepared = readAgentObject(step.prepared);
    const parameters = readAgentObject(prepared.parameters);
    for (const asset of readTicketAssets(parameters))
      ticketAssets.set(`${asset.source}:${asset.id}`, asset);
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
      if (value.type === "ticket") ticketIds.add(readPlanText(value.ticketId));
    }
  }
  return {
    remoteWorkspaceIds: remoteWorkspaceIds(snapshot),
    ...planTarget(plan),
    projectId: readPlanText(plan.projectId),
    workspaceIds: [...workspaceIds],
    taskIds: [...taskIds],
    wikiIds: [...wikiIds],
    ticketIds: [...ticketIds],
    agentIds: [...agentIds],
    connectionIds: [...connectionIds],
    ticketAssets: [...ticketAssets.values()],
  };
}

/** The plan target the snapshot froze; a missing or unreadable one is the Pages host. */
function planTarget(
  plan: Record<string, unknown>,
): Pick<AgentPlanRunResources, "executionTarget"> {
  const target = planExecutionTargetSchema.safeParse(plan.executionTarget);
  return target.success ? { executionTarget: target.data } : {};
}

function addModelReference(
  node: Record<string, unknown>,
  references: {
    readonly agentIds: Set<string>;
    readonly connectionIds: Set<string>;
  },
): void {
  const configuration = node.configuration
    ? readAgentObject(node.configuration)
    : null;
  if (configuration?.runnerRoute) return;
  if (configuration?.connectionId)
    references.connectionIds.add(readPlanText(configuration.connectionId));
  else references.agentIds.add(readPlanText(node.agentId));
}

function addStepModelReference(
  step: Record<string, unknown>,
  references: {
    readonly agentIds: Set<string>;
    readonly connectionIds: Set<string>;
  },
): void {
  if (step.step) addModelReference(readAgentObject(step.step), references);
}

function remoteWorkspaceIds(
  snapshot: Record<string, unknown>,
): readonly string[] {
  const steps: readonly unknown[] = Array.isArray(snapshot.remoteSteps)
    ? snapshot.remoteSteps
    : [];
  return [
    ...new Set(
      steps.map((step) =>
        readPlanText(readAgentObject(readAgentObject(step).target).workspaceId),
      ),
    ),
  ];
}
