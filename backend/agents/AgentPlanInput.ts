import { AgentError } from "@/backend/error/AgentErrors";
import { isAgentParameterName } from "@/definition/AgentParameters";
import { planValueIssue } from "@/definition/AgentPlanValue";

import {
  readAgentParameterValue,
  readAgentTargets,
} from "./AgentConfigurationInput";
import { readPlanConfiguration } from "./AgentPlanConfigurationInput";
import { readAgentObject } from "./AgentPayload";

import type {
  AgentPlanBinding,
  AgentPlanEdge,
  AgentPlanInput,
  AgentPlanNode,
  AgentPlanPosition,
  AgentPlanParameter,
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

/** Parses one parameter source of an agent node: a value, a source node or a step result. */
export function readPlanBinding(input: unknown): AgentPlanBinding {
  const binding = readPlanObject(input);
  const allowed = {
    literal: ["kind", "value"],
    source: ["kind", "nodeId"],
    result: ["kind", "stepId"],
  };
  if (
    binding.kind !== "literal" &&
    binding.kind !== "source" &&
    binding.kind !== "result"
  )
    throw new AgentError("plan_invalid");
  const keys = allowed[binding.kind];
  if (Object.keys(binding).some((key) => !keys.includes(key)))
    throw new AgentError("plan_binding_invalid");
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
  const bindings = readPlanObject(input);
  if (Object.keys(bindings).length > 64) throw new AgentError("plan_invalid");
  return Object.fromEntries(
    Object.entries(bindings).map(([name, binding]) => {
      if (!isAgentParameterName(name)) throw new AgentError("plan_invalid");
      return [name, readPlanBinding(binding)];
    }),
  );
}

/** Parses one bounded node; its references are checked when the plan is saved. */
export function readPlanNode(input: unknown): AgentPlanNode {
  const node = readPlanObject(input);
  const base = { id: readPlanText(node.id), ...readPosition(node) };
  if (node.type === "start" || node.type === "end")
    return { ...base, type: node.type };
  if (node.type === "parameter") return readParameterNode(node, base);
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
    agentId: node.agentId === "" ? "" : readPlanText(node.agentId),
    personalAgentId:
      node.personalAgentId === null || node.personalAgentId === ""
        ? node.personalAgentId
        : readPlanText(node.personalAgentId),
    instruction: node.instruction,
    ...(node.configuration === undefined
      ? {}
      : { configuration: readPlanConfiguration(node.configuration) }),
    bindings: readBindings(node.bindings),
  };
}

function readEdge(input: unknown): AgentPlanEdge {
  const edge = readPlanObject(input);
  if (edge.kind !== undefined && edge.kind !== "flow")
    throw new AgentError("plan_invalid");
  return {
    from: readPlanText(edge.from),
    to: readPlanText(edge.to),
    fromPort:
      edge.fromPort === undefined ? "flow-out" : readPlanText(edge.fromPort),
    toPort: edge.toPort === undefined ? "flow-in" : readPlanText(edge.toPort),
  };
}

function readParameterNode(
  node: Record<string, unknown>,
  base: AgentPlanPosition & { readonly id: string },
): AgentPlanParameter {
  const name = readPlanText(node.name, 64);
  const format = node.format;
  if (
    !isAgentParameterName(name) ||
    (format !== "string" && format !== "number" && format !== "json")
  )
    throw new AgentError("plan_invalid");
  const parameter: AgentPlanParameter = {
    ...base,
    type: "parameter",
    name,
    format,
    value: readAgentParameterValue(node.value),
  };
  const issue = planValueIssue(parameter);
  if (issue !== null)
    throw new AgentError(
      issue === "json" ? "plan_json_invalid" : "plan_number_invalid",
    );
  return parameter;
}

function readSharing(input: unknown): NonNullable<AgentPlanInput["sharing"]> {
  const sharing = readPlanObject(input);
  const targets = readAgentTargets(sharing.targets);
  const operator = sharing.operator === undefined ? "or" : sharing.operator;
  if (
    typeof sharing.isGlobal !== "boolean" ||
    (operator !== "or" && operator !== "and") ||
    targets.some(
      (target) => target.kind !== "group" && target.kind !== "department",
    )
  )
    throw new AgentError("plan_invalid");
  return { isGlobal: sharing.isGlobal, targets, operator };
}

function readGlobals(input: unknown): Readonly<Record<string, string>> {
  const globals = readPlanObject(input);
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
  const plan = readPlanObject(input);
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
    ...(plan.projectId === undefined
      ? {}
      : { projectId: readPlanText(plan.projectId) }),
    ...(plan.sharing === undefined
      ? {}
      : { sharing: readSharing(plan.sharing) }),
    globals: readGlobals(plan.globals),
    nodes: plan.nodes.map(readPlanNode),
    edges: plan.edges.map(readEdge),
    ...(revision === undefined ? {} : { revision }),
  };
}

function readPlanObject(input: unknown): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    throw new AgentError("plan_invalid");
  return readAgentObject(input);
}
