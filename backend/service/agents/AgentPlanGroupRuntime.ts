import { AgentPlanValidationError } from "@/backend/error/AgentPlanValidationError";
import {
  agentRunOptionsFor,
  isAcpProvider,
} from "@/definition/AgentConfiguration";
import { claudeAcpProfile } from "@/backend/agents/acp/ClaudeAcpProfile";
import { codexAcpProfile } from "@/backend/agents/acp/CodexAcpProfile";

import { planStepDirectory } from "./AgentPlanSnapshot";

import type { AgentRunOptions } from "@/definition/AgentConfiguration";
import type { AgentProviderId } from "@/definition/AgentConnection";
import type { AgentPlanGroup } from "@/definition/AgentPlanGroup";
import type { AgentPlanStepSnapshot } from "./AgentPlanSnapshot";

/** The tools, permissions and sandbox the adapter's mode profile gives a session. */
function profileFields(
  provider: AgentProviderId,
  options: AgentRunOptions,
): Readonly<Record<"tools" | "permissions" | "sandbox", string>> {
  const mode = options.access === "yolo" ? "yolo" : "read_only";
  const tools = { shell: options.shell, web: options.web };
  if (provider === "claude_code") {
    const profile = claudeAcpProfile(mode);
    return {
      tools: JSON.stringify({ ...tools, options: profile.options }),
      permissions: JSON.stringify(profile.permissions),
      sandbox: profile.sessionMode,
    };
  }
  const profile = codexAcpProfile(mode);
  return {
    tools: JSON.stringify({ ...tools, configuration: profile.configuration }),
    permissions: JSON.stringify(profile.permissions),
    sandbox: profile.permissions.sandbox,
  };
}

/** Resolved technical fields only; credentials never enter this comparison or its errors. */
export function groupRuntimeFields(
  step: Pick<
    AgentPlanStepSnapshot,
    | "provider"
    | "connectionId"
    | "model"
    | "reasoningEffort"
    | "template"
    | "prepared"
  >,
): Readonly<Record<string, string>> {
  const options = agentRunOptionsFor(step.provider, step.template.run);
  const directory = planStepDirectory(step);
  return {
    "provider/adapter": step.provider,
    connectionId: step.connectionId ?? "",
    model: step.model,
    reasoningEffort: step.reasoningEffort ?? "adapter-default",
    workspace: directory?.id ?? "",
    directory: directory?.path ?? "",
    directoryIdentity: directory?.directoryIdentity ?? "",
    ...profileFields(step.provider, options),
    access: options.access,
  };
}

/**
 * Rejects a conflicting agent and field before the plan acquires any execution resources.
 *
 * @remarks
 * Every member runs over ACP with the adapter class of the first member. The
 * same class guarantees nothing more: connection, workspace, model, effort,
 * tools, permissions and sandbox are compared too, and a difference is
 * reported instead of being adjusted.
 */
export function validateGroupRuntimes(
  groups: readonly AgentPlanGroup[],
  steps: readonly AgentPlanStepSnapshot[],
): void {
  for (const group of groups) {
    let expected: Readonly<Record<string, string>> | null = null;
    for (const child of group.steps) {
      const step = steps.find((entry) => entry.step.id === child.id);
      if (!step)
        throw new AgentPlanValidationError([
          { nodeId: child.id, port: null, reason: "agent" },
        ]);
      if (!isAcpProvider(step.provider))
        throw new AgentPlanValidationError([
          {
            nodeId: child.id,
            port: "provider/adapter",
            reason: "groupProvider",
          },
        ]);
      const fields = groupRuntimeFields(step);
      requireCompatibleFields(child.id, fields, expected);
      expected = fields;
    }
  }
}

/** Reports the child identifier and conflicting field without including credential values. */
export function requireCompatibleFields(
  id: string,
  fields: Readonly<Record<string, string>>,
  expected: Readonly<Record<string, string>> | null,
): void {
  if (!expected) return;
  const conflict = Object.keys(fields).find(
    (field) => fields[field] !== expected[field],
  );
  if (conflict)
    throw new AgentPlanValidationError([
      {
        nodeId: id,
        port: conflict,
        reason:
          conflict === "provider/adapter"
            ? "groupProvider"
            : "groupConfiguration",
      },
    ]);
}
