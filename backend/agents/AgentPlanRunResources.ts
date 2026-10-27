import { planExecutionTargetSchema } from "@/definition/AgentPlanExecution";

import { readPlanText } from "./AgentPlanInput";
import { readAgentObject } from "./AgentPayload";

import type { AgentPlanRun } from "@/definition/AgentPlan";
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
  addRemoteResources(snapshot, { ticketIds, wikiIds, ticketAssets });
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
      steps.flatMap((entry) => {
        const step = readAgentObject(entry);
        const parameters = step.parameters
          ? readAgentObject(step.parameters)
          : null;
        const workspaces = parameters
          ? Object.keys(readAgentObject(parameters.workspaces))
          : [];
        return [
          readPlanText(readAgentObject(step.target).workspaceId),
          ...workspaces,
        ];
      }),
    ),
  ];
}

function addRemoteResources(
  snapshot: Record<string, unknown>,
  references: {
    readonly ticketIds: Set<string>;
    readonly wikiIds: Set<string>;
    readonly ticketAssets: Map<string, AgentTicketAsset>;
  },
): void {
  const steps: readonly unknown[] = Array.isArray(snapshot.remoteSteps)
    ? snapshot.remoteSteps
    : [];
  for (const entry of steps) {
    const step = readAgentObject(entry);
    if (!step.parameters) continue;
    const parameters = readAgentObject(step.parameters);
    for (const id of Object.keys(readAgentObject(parameters.tickets)))
      references.ticketIds.add(id);
    for (const id of Object.keys(readAgentObject(parameters.wiki)))
      references.wikiIds.add(id);
    const assets: readonly unknown[] = Array.isArray(parameters.assets)
      ? parameters.assets
      : [];
    for (const assetEntry of assets) {
      const asset = readAgentObject(readAgentObject(assetEntry).reference);
      if (
        asset.source !== "ticket" &&
        asset.source !== "wiki" &&
        asset.source !== "agent"
      )
        throw new Error("Invalid remote asset");
      references.ticketAssets.set(`${asset.source}:${readPlanText(asset.id)}`, {
        source: asset.source,
        id: readPlanText(asset.id),
        link: readPlanText(asset.link),
      });
    }
  }
}

/** Combines pinned resources and server-recorded tool downloads for historical result authorization. */
export function allRunAssetReferences(
  run: Pick<AgentPlanRun, "steps">,
  pinned: readonly AgentTicketAsset[] = [],
): readonly AgentTicketAsset[] {
  const references = new Map<string, AgentTicketAsset>();
  for (const asset of pinned)
    references.set(`${asset.source}:${asset.id}`, asset);
  for (const step of run.steps) {
    for (const file of step.resourceAccess?.files ?? []) {
      if (file.asset)
        references.set(`${file.asset.source}:${file.asset.id}`, file.asset);
    }
  }
  return [...references.values()];
}
