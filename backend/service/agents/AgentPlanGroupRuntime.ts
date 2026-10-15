import { AgentPlanValidationError } from "@/backend/error/AgentPlanValidationError";
import { agentRunOptionsFor } from "@/definition/AgentConfiguration";
import { codexAcpProfile } from "@/backend/agents/acp/CodexAcpProfile";

import { planStepDirectory } from "./AgentPlanSnapshot";

import type { AgentPlanGroup } from "@/definition/AgentPlanGroup";
import type { AgentPlanStepSnapshot } from "./AgentPlanSnapshot";

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
  const profile =
    options.access === "yolo"
      ? codexAcpProfile("yolo")
      : codexAcpProfile("read_only");
  return {
    "provider/adapter": step.provider,
    connectionId: step.connectionId ?? "",
    model: step.model,
    reasoningEffort: step.reasoningEffort ?? "adapter-default",
    workspace: directory?.id ?? "",
    directory: directory?.path ?? "",
    directoryIdentity: directory?.directoryIdentity ?? "",
    tools: JSON.stringify({
      shell: options.shell,
      web: options.web,
      configuration: profile.configuration,
    }),
    permissions: JSON.stringify(profile.permissions),
    sandbox: profile.permissions.sandbox,
    access: options.access,
  };
}

/** Rejects a conflicting agent and field before the plan acquires any execution resources. */
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
      if (step.provider !== "codex_cli")
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
      { nodeId: id, port: conflict, reason: "groupConfiguration" },
    ]);
}
