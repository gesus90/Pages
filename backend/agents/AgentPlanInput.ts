import { AGENT_READ_LIMITS } from "@/definition/AgentReadChunks";
import { planExecutionTargetSchema } from "@/definition/AgentPlanExecution";
import { emptyAgentConfiguration } from "@/definition/AgentConfiguration";
import { AgentError } from "@/backend/error/AgentErrors";
import { isAgentParameterName } from "@/definition/AgentParameters";
import { planValueIssue } from "@/definition/AgentPlanValue";
import { planScriptIssues } from "@/definition/AgentPlanScript";
import {
  PLAN_LOOP_MEMBER_COUNT,
  PLAN_LOOP_NAME_LENGTH,
  isPlanLoopRuns,
} from "@/definition/AgentPlanLoop";

import {
  readAgentParameterValue,
  readAgentConfiguration,
  readAgentTargets,
} from "./AgentConfigurationInput";
import { readPlanConfiguration } from "./AgentPlanConfigurationInput";
import { readPlanLoopCondition } from "./AgentPlanLoopInput";
import { readAgentObject } from "./AgentPayload";
import { readCompletionGate } from "./AgentPlanWorkInput";

import type { AgentPlanGroup } from "@/definition/AgentPlanGroup";
import type {
  AgentPlanLoop,
  AgentPlanLoopMember,
} from "@/definition/AgentPlanLoop";
import type {
  AgentPlanScript,
  AgentPlanScriptInput,
  AgentPlanScriptOutput,
} from "@/definition/AgentPlanScript";
import type { AgentPlanCompletion } from "@/definition/AgentPlanSession";
import type {
  AgentPlanBinding,
  AgentPlanEdge,
  AgentPlanInput,
  AgentPlanNode,
  AgentPlanPosition,
  AgentPlanParameter,
  AgentPlanStep,
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
    previous: ["kind", "stepId"],
  };
  if (
    binding.kind !== "literal" &&
    binding.kind !== "source" &&
    binding.kind !== "result" &&
    binding.kind !== "previous"
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
  return { kind: "previous", stepId: readPlanText(binding.stepId) };
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
  const base = readNodeBase(node);
  if (node.type === "start" || node.type === "end")
    return { ...base, type: node.type };
  if (node.type === "parameter") return readParameterNode(node, base);
  if (node.type === "group") return readGroupNode(node, base);
  if (node.type === "loop") return readLoopNode(node, base);
  if (node.type === "script") return readScriptNode(node, base);
  if (node.type === "task")
    return { ...base, type: "task", taskId: readPlanText(node.taskId) };
  if (node.type === "variable") {
    const name = readPlanText(node.name, 64);
    if (!isAgentParameterName(name)) throw new AgentError("plan_invalid");
    return { ...base, type: "variable", name };
  }
  return readStepNode(node, base);
}

function readNodeBase(
  node: Record<string, unknown>,
): AgentPlanPosition & { readonly id: string } {
  return { id: readPlanText(node.id), ...readPosition(node) };
}

function readExecutionTarget(
  input: unknown,
): Pick<AgentPlanInput, "executionTarget"> {
  if (input === undefined) return {};
  const parsed = planExecutionTargetSchema.safeParse(input);
  if (!parsed.success) throw new AgentError("plan_invalid");
  return { executionTarget: parsed.data };
}

function readStepNode(
  node: Record<string, unknown>,
  base: AgentPlanPosition & { readonly id: string },
): AgentPlanStep {
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
    ...(node.completionGate === undefined
      ? {}
      : { completionGate: readCompletionGate(node.completionGate) }),
    ...readExecutionTarget(node.executionTarget),
    ...(node.configuration === undefined
      ? {}
      : { configuration: readPlanConfiguration(node.configuration) }),
    ...(readCompletion(node.completion) === "todos"
      ? { completion: "todos" as const }
      : {}),
    bindings: readBindings(node.bindings),
  };
}

/** Narrows the completion of a node; `report` is the default and is not stored. */
function readCompletion(input: unknown): AgentPlanCompletion {
  if (input === undefined || input === "report") return "report";
  if (input === "todos") return "todos";
  throw new AgentError("plan_invalid");
}

/** Reads declared inputs or outputs: text entries with a name and further flags. */
function readScriptEntries(input: unknown): readonly {
  readonly name: string;
  readonly isRequired: unknown;
  readonly policy: unknown;
}[] {
  if (!Array.isArray(input) || input.length > 64)
    throw new AgentError("plan_script_invalid");
  return input.map((entry: unknown) => {
    const { name, type, isRequired, policy } = readPlanObject(entry);
    if (typeof name !== "string" || type !== "text")
      throw new AgentError("plan_script_invalid");
    return { name, isRequired, policy };
  });
}

function readScriptInputs(input: unknown): readonly AgentPlanScriptInput[] {
  return readScriptEntries(input).map(({ name, isRequired }) => {
    if (typeof isRequired !== "boolean")
      throw new AgentError("plan_script_invalid");
    return { name, type: "text", isRequired };
  });
}

function readScriptOutputs(input: unknown): readonly AgentPlanScriptOutput[] {
  return readScriptEntries(input).map(({ name, policy }) => {
    if (policy !== undefined && policy !== "report" && policy !== "gate")
      throw new AgentError("plan_script_invalid");
    return { name, type: "text", ...(policy ? { policy } : {}) };
  });
}

/**
 * Parses a script node; its own configuration is checked completely here.
 *
 * @throws {AgentError} `plan_script_invalid` for a missing or malformed field,
 * an empty or too long content, invalid or repeated names or a timeout out of
 * bounds. Whether the profile exists is checked when the plan is saved.
 */
function readScriptNode(
  node: Record<string, unknown>,
  base: AgentPlanPosition & { readonly id: string },
): AgentPlanScript {
  const { name, interpreterProfileId, content, timeoutSeconds } = node;
  if (
    typeof name !== "string" ||
    typeof interpreterProfileId !== "string" ||
    typeof content !== "string" ||
    typeof timeoutSeconds !== "number"
  )
    throw new AgentError("plan_script_invalid");
  const script: AgentPlanScript = {
    ...base,
    ...readExecutionTarget(node.executionTarget),
    type: "script",
    name: name.trim(),
    interpreterProfileId,
    content,
    inputs: readScriptInputs(node.inputs),
    outputs: readScriptOutputs(node.outputs),
    timeoutSeconds,
    bindings: readBindings(node.bindings),
  };
  if (planScriptIssues(script).length > 0)
    throw new AgentError("plan_script_invalid");
  return script;
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

/** Parses the sharing of a plan, the same way whether the whole plan or only this part is read. */
export function readPlanSharing(
  input: unknown,
): NonNullable<AgentPlanInput["sharing"]> {
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
    plan.nodes.length > AGENT_READ_LIMITS.planNodes ||
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
  const nodes = plan.nodes.map(readPlanNode);
  if (
    nodes.reduce(
      (count, node) =>
        count +
        1 +
        (node.type === "group" || node.type === "loop" ? node.steps.length : 0),
      0,
    ) > AGENT_READ_LIMITS.planNodes
  )
    throw new AgentError("plan_invalid");
  return {
    name: readPlanText(plan.name, 120),
    workspaceId: readWorkspaceBinding(plan.workspaceId),
    usage: plan.usage,
    ...(plan.projectId === undefined
      ? {}
      : { projectId: readPlanText(plan.projectId) }),
    ...(plan.sharing === undefined
      ? {}
      : { sharing: readPlanSharing(plan.sharing) }),
    ...readExecutionTarget(plan.executionTarget),
    globals: readGlobals(plan.globals),
    nodes,
    edges: plan.edges.map(readEdge),
    ...(revision === undefined ? {} : { revision }),
  };
}

function readWorkspaceBinding(input: unknown): string {
  return input === "" ? "" : readPlanText(input);
}

function readPlanObject(input: unknown): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    throw new AgentError("plan_invalid");
  return readAgentObject(input);
}

function readGroupEdges(input: unknown): readonly AgentPlanEdge[] {
  if (!Array.isArray(input) || input.length > 100)
    throw new AgentError("plan_invalid");
  return input.map(readEdge);
}

function readGroupNode(
  node: Record<string, unknown>,
  base: AgentPlanPosition & { readonly id: string },
): AgentPlanGroup {
  if (
    !Array.isArray(node.steps) ||
    node.steps.length > 50 ||
    !Array.isArray(node.parameters) ||
    node.parameters.length > 64
  )
    throw new AgentError("plan_invalid");
  const steps = node.steps.map((input: unknown) => {
    const raw = readPlanObject(input);
    if (raw.type !== "agent") throw new AgentError("plan_invalid");
    const step = readStepNode(raw, readNodeBase(raw));
    if (step.completionGate) throw new AgentError("plan_work_gate_unavailable");
    return step;
  });
  const ports: readonly unknown[] = node.parameters;
  const configuration = readAgentConfiguration({
    ...emptyAgentConfiguration(),
    parameters: ports,
    markdown: "",
  });
  const parameters = configuration.parameters.map((parameter, index) => ({
    ...parameter,
    id: readPlanText(readPlanObject(ports[index]).id),
  }));
  return {
    ...base,
    type: "group",
    name: readPlanText(node.name, 120),
    steps,
    // Absent edges mark a group saved before them; it keeps reading as the chain of its members.
    ...(node.edges === undefined ? {} : { edges: readGroupEdges(node.edges) }),
    parameters,
    bindings: readBindings(node.bindings),
  };
}

/**
 * Parses a loop node with its members; its own fields are checked completely here.
 *
 * @throws {AgentError} `plan_loop_invalid` for a malformed field or a member
 * that is neither an agent nor a script, `plan_loop_runs_invalid` for a saved
 * count outside the whole numbers 1 to 999. A count is never corrected.
 */
function readLoopNode(
  node: Record<string, unknown>,
  base: AgentPlanPosition & { readonly id: string },
): AgentPlanLoop {
  if (
    !Array.isArray(node.steps) ||
    node.steps.length > PLAN_LOOP_MEMBER_COUNT ||
    (node.countMode !== "max" && node.countMode !== "expected") ||
    (node.sessionPolicy !== "reuse" && node.sessionPolicy !== "fresh") ||
    (node.runsSource !== "value" && node.runsSource !== "parameter")
  )
    throw new AgentError("plan_loop_invalid");
  if (!isPlanLoopRuns(node.runs))
    throw new AgentError("plan_loop_runs_invalid");
  const steps = node.steps.map((input: unknown): AgentPlanLoopMember => {
    const member = readPlanNode(input);
    if (member.type === "agent" && member.completionGate)
      throw new AgentError("plan_work_gate_unavailable");
    if (member.type === "loop" || member.type === "group")
      throw new AgentError("plan_loop_nested");
    if (member.type !== "agent" && member.type !== "script")
      throw new AgentError("plan_loop_invalid");
    return member;
  });
  return {
    ...base,
    type: "loop",
    name: readPlanText(node.name, PLAN_LOOP_NAME_LENGTH),
    steps,
    edges: readGroupEdges(node.edges),
    runs: node.runs,
    runsSource: node.runsSource,
    bindings: readBindings(node.bindings),
    countMode: node.countMode,
    sessionPolicy: node.sessionPolicy,
    condition: readPlanLoopCondition(node.condition),
  };
}
