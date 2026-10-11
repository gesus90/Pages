import { AgentError } from "@/backend/error/AgentErrors";

import { readAgentTargets } from "./AgentConfigurationInput";
import { readAgentObject } from "./AgentPayload";

import type {
  AgentWorkspaceInput,
  AgentWorkspaceTarget,
} from "@/definition/AgentWorkspace";

function readText(input: unknown, maximum: number): string {
  if (
    typeof input !== "string" ||
    !input.trim() ||
    input.length > maximum ||
    /[\u0000-\u001f\u007f]/u.test(input)
  )
    throw new AgentError("workspace_invalid");
  return input.trim();
}

/** Narrows organizational grants and rejects global/system directory access. */
export function readWorkspaceTargets(
  input: unknown,
): readonly AgentWorkspaceTarget[] {
  return readAgentTargets(input).map((target) => {
    if (target.kind === "system") throw new AgentError("workspace_invalid");
    return { kind: target.kind, targetId: target.targetId };
  });
}

/** Validates registration metadata before any filesystem operation. */
export function readWorkspaceInput(input: unknown): AgentWorkspaceInput {
  const workspace = readAgentObject(input);
  const targets = readWorkspaceTargets(workspace.targets);
  if (targets.length === 0) throw new AgentError("workspace_invalid");
  const revision = workspace.revision;
  if (
    revision !== undefined &&
    (typeof revision !== "number" ||
      !Number.isSafeInteger(revision) ||
      revision < 1)
  )
    throw new AgentError("workspace_invalid");
  return {
    name: readText(workspace.name, 120),
    path: readText(workspace.path, 4096),
    projectId: readText(workspace.projectId, 100),
    targets,
    ...(revision === undefined ? {} : { revision }),
  };
}
