import { isApiProvider } from "@/definition/AgentConnection";

import { sanitizeArtifactText } from "./AgentPlanOutput";
import { planStepDirectory } from "./AgentPlanSnapshot";
import { remoteWorkspaceKeys } from "./AgentPlanRemoteWorkspaceKey";

import type {
  AgentPlanConflictTarget,
  AgentPlanWorkspaceConflict,
} from "@/definition/AgentPlanWorkspaceConflict";
import type { ResolvedAgentWorkspace } from "@/definition/AgentWorkspace";
import type { AgentPlanSnapshot } from "./AgentPlanSnapshot";
import type { RemotePlanStep } from "./AgentPlanRemoteExecution";

/** One current plan node and its authorized execution target. */
export interface WorkspaceConflictEntry {
  readonly id: string;
  readonly name: string;
  readonly target: AgentPlanConflictTarget;
}

/** The local registration is resolved before the start check builds this entry. */
export function localWorkspaceEntry(
  workspace: ResolvedAgentWorkspace,
  id: string,
  name: string,
): WorkspaceConflictEntry {
  return {
    id,
    name,
    target: {
      kind: "local",
      workspaceId: workspace.id,
      path: workspace.path,
      connectionName: null,
      workspaceName: null,
    },
  };
}

/** Remote names and path come from the currently authorized target registration. */
export function remoteWorkspaceEntry(
  remote: RemotePlanStep,
): WorkspaceConflictEntry {
  const node = remote.step;
  return {
    id: node.id,
    name:
      node.type === "script"
        ? node.name
        : (node.configuration?.name ?? node.agentId),
    target: {
      kind: "remote",
      workspaceId: remote.target.workspaceId,
      path: remote.target.path,
      connectionName: remote.target.connectionName,
      workspaceName: remote.target.workspaceName,
    },
  };
}

/** Deduplicates a plan's own nodes and targets, filtering text for presentation. */
export function workspaceConflict(
  kind: AgentPlanWorkspaceConflict["kind"],
  entries: readonly WorkspaceConflictEntry[],
): AgentPlanWorkspaceConflict {
  const nodes = new Map<string, { id: string; name: string }>();
  const targets = new Map<string, AgentPlanConflictTarget>();
  for (const entry of entries) {
    nodes.set(entry.id, {
      id: entry.id,
      name: sanitizeArtifactText(entry.name),
    });
    const target = {
      ...entry.target,
      path: sanitizeArtifactText(entry.target.path),
      connectionName: entry.target.connectionName
        ? sanitizeArtifactText(entry.target.connectionName)
        : null,
      workspaceName: entry.target.workspaceName
        ? sanitizeArtifactText(entry.target.workspaceName)
        : null,
    };
    targets.set(JSON.stringify(target), target);
  }
  return { kind, targets: [...targets.values()], nodes: [...nodes.values()] };
}

/** Finds the current plan nodes that use a registered workspace held by another run. */
export function reservedWorkspaceConflict(
  snapshot: AgentPlanSnapshot,
  workspaceId: string,
): AgentPlanWorkspaceConflict {
  const entries: WorkspaceConflictEntry[] = [];
  for (const script of snapshot.scripts ?? [])
    if (script.workspace.id === workspaceId)
      entries.push(
        localWorkspaceEntry(script.workspace, script.step.id, script.step.name),
      );
  for (const step of snapshot.steps) {
    const directory = planStepDirectory(step);
    if (!isApiProvider(step.provider) && directory?.id === workspaceId)
      entries.push(localWorkspaceEntry(directory, step.step.id, step.name));
  }
  for (const remote of snapshot.remoteSteps ?? []) {
    if (
      remote.target.workspaceId !== workspaceId &&
      !remoteWorkspaceKeys(remote.target).includes(workspaceId)
    )
      continue;
    entries.push(remoteWorkspaceEntry(remote));
  }
  return workspaceConflict("reserved", entries);
}
