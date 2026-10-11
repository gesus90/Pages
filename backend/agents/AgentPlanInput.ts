import { AgentError } from "@/backend/error/AgentErrors";
import { isAgentParameterName } from "@/definition/AgentParameters";

import { readAgentParameterValue } from "./AgentConfigurationInput";
import { readAgentObject } from "./AgentPayload";

import type {
  AgentPlanBinding,
  AgentPlanEdge,
  AgentPlanInput,
  AgentPlanNode,
  AgentPlanPosition,
} from "@/definition/AgentPlan";

/** Bounds untrusted graph labels and identifiers before any resource lookup. */
export function readPlanText(input: unknown, maximum = 100): string {
  if (
    typeof input !== "string" ||
    !input.trim() ||
    input.length > maximum ||
    /[\u0000-\u001f\u007f]/u.test(input)
  )
    throw new AgentError("plan_invalid");
  return input.trim();
}

function readPosition(input: Record<string, unknown>): AgentPlanPosition {
  const { x, y } = input;
  if (
    typeof x !== "number" ||
    typeof y !== "number" ||
    !Number.isInteger(x) ||
    !Number.isInteger(y) ||
    x < 0 ||
    y < 0 ||
    x > 6000 ||
    y > 6000
  )
    throw new AgentError("plan_invalid");
  return { x, y };
}

function readBinding(input: unknown): AgentPlanBinding {
  const binding = readAgentObject(input);
  if (binding.kind === "literal")
    return {
      kind: "literal",
      value:
        binding.value === null ? null : readAgentParameterValue(binding.value),
    };
  if (binding.kind === "source")
    return { kind: "source", nodeId: readPlanText(binding.nodeId) };
  if (binding.kind === "result")
    return { kind: "result", stepId: readPlanText(binding.stepId) };
  throw new AgentError("plan_invalid");
}

function readBindings(
  input: unknown,
): Readonly<Record<string, AgentPlanBinding>> {
  const bindings = readAgentObject(input);
  if (Object.keys(bindings).length > 64) throw new AgentError("plan_invalid");
  return Object.fromEntries(
    Object.entries(bindings).map(([name, binding]) => {
      if (!isAgentParameterName(name)) throw new AgentError("plan_invalid");
      return [name, readBinding(binding)];
    }),
  );
}

function readNode(input: unknown): AgentPlanNode {
  const node = readAgentObject(input);
  const base = { id: readPlanText(node.id), ...readPosition(node) };
  if (node.type === "task")
    return { ...base, type: "task", taskId: readPlanText(node.taskId) };
  if (node.type === "variable") {
    const name = readPlanText(node.name, 64);
    if (!isAgentParameterName(name)) throw new AgentError("plan_invalid");
    return { ...base, type: "variable", name };
  }
  if (
    node.type !== "agent" ||
    typeof node.instruction !== "string" ||
    node.instruction.length > 200000
  )
    throw new AgentError("plan_invalid");
  return {
    ...base,
    type: "agent",
    agentId: readPlanText(node.agentId),
    personalAgentId:
      node.personalAgentId === null ? null : readPlanText(node.personalAgentId),
    instruction: node.instruction,
    bindings: readBindings(node.bindings),
  };
}

function readEdge(input: unknown): AgentPlanEdge {
  const edge = readAgentObject(input);
  return { from: readPlanText(edge.from), to: readPlanText(edge.to) };
}

function readGlobals(input: unknown): Readonly<Record<string, string>> {
  const globals = readAgentObject(input);
  if (Object.keys(globals).length > 64) throw new AgentError("plan_invalid");
  return Object.fromEntries(
    Object.entries(globals).map(([name, text]) => {
      if (
        !isAgentParameterName(name) ||
        typeof text !== "string" ||
        text.length > 200000
      )
        throw new AgentError("plan_invalid");
      return [name, text];
    }),
  );
}

/** Parses one bounded plan; graph relationships are validated by the service. */
export function readPlanInput(input: unknown): AgentPlanInput {
  const plan = readAgentObject(input);
  if (
    !Array.isArray(plan.nodes) ||
    plan.nodes.length > 100 ||
    !Array.isArray(plan.edges) ||
    plan.edges.length > 500 ||
    (plan.usage !== "private" && plan.usage !== "workspace")
  )
    throw new AgentError("plan_invalid");
  const revision = plan.revision;
  if (
    revision !== undefined &&
    (typeof revision !== "number" ||
      !Number.isSafeInteger(revision) ||
      revision < 1)
  )
    throw new AgentError("plan_invalid");
  return {
    name: readPlanText(plan.name, 120),
    workspaceId: readPlanText(plan.workspaceId),
    usage: plan.usage,
    globals: readGlobals(plan.globals),
    nodes: plan.nodes.map(readNode),
    edges: plan.edges.map(readEdge),
    ...(revision === undefined ? {} : { revision }),
  };
}
