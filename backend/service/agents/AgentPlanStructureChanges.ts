import { randomUUID } from "node:crypto";

import { readPlanNode } from "@/backend/agents/AgentPlanInput";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { removePlanNode } from "@/definition/AgentPlanGraph";

import { AGENT_PLAN_NODE_FIELDS } from "./AgentPlanOperationInput";

import type { AgentDefinitionChoice } from "@/definition/AgentAvailability";
import type {
  AgentPlanInput,
  AgentPlanNode,
  AgentPlanParameter,
  AgentPlanStep,
} from "@/definition/AgentPlan";
import type { AgentRejectionReason } from "@/definition/PagesAgentOperations";
import type { AgentPlanChange } from "./AgentPlanOperationInput";

/** The editor's spacing between nodes, so plans built here look like those built there. */
const COLUMN_WIDTH = 320;
const ROW_HEIGHT = 340;
const PARAMETER_ROW_HEIGHT = 160;
const LIMIT = 6000;

/** What applying changes needs besides the plan. */
export interface AgentPlanChangeContext {
  /** The agents the plan's workspace offers; an added agent node takes its defaults from them. */
  readonly agents: readonly AgentDefinitionChoice[];
}

/** The changed plan and the identifiers of the nodes the changes added. */
export interface AgentPlanChangeResult {
  readonly plan: AgentPlanInput;
  readonly createdNodeIds: readonly string[];
}

function refused(reason: AgentRejectionReason["reason"]): AgentOperationError {
  return new AgentOperationError("INVALID_REQUEST", { reason });
}

function bounded(coordinate: number): number {
  return Math.min(LIMIT, Math.max(0, coordinate));
}

/** The next free slot of the editor's three-column layout. */
function nextPosition(plan: AgentPlanInput): { x: number; y: number } {
  const count = plan.nodes.length;
  return {
    x: bounded(40 + (count % 3) * COLUMN_WIDTH),
    y: bounded(40 + Math.floor(count / 3) * ROW_HEIGHT),
  };
}

function findNode(plan: AgentPlanInput, id: string): AgentPlanNode {
  const node = plan.nodes.find((entry) => entry.id === id);
  if (!node) throw refused("element_missing");
  return node;
}

function findStep(plan: AgentPlanInput, id: string): AgentPlanStep {
  const node = findNode(plan, id);
  if (node.type !== "agent") throw refused("element_missing");
  return node;
}

/** Parameter names name one value each, so a client and a person can find it by name. */
function requireFreeName(
  plan: AgentPlanInput,
  node: AgentPlanNode,
  exceptId: string | null,
): void {
  if (
    node.type === "parameter" &&
    plan.nodes.some(
      (entry) =>
        entry.type === "parameter" &&
        entry.name === node.name &&
        entry.id !== exceptId,
    )
  )
    throw refused("element_exists");
}

function replaceNode(
  plan: AgentPlanInput,
  node: AgentPlanNode,
): AgentPlanInput {
  return {
    ...plan,
    nodes: plan.nodes.map((entry) => (entry.id === node.id ? node : entry)),
  };
}

/** The format a parameter takes when none is given: a number stays a number. */
function defaultFormat(value: unknown): AgentPlanParameter["format"] {
  return typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === "number"
    ? "number"
    : "string";
}

function newNodeFields(
  change: Extract<AgentPlanChange, { action: "addNode" }>,
): Readonly<Record<string, unknown>> {
  if (change.type === "agent")
    return { personalAgentId: null, instruction: "", bindings: {} };
  if (change.type === "parameter")
    return { format: defaultFormat(change.fields.value) };
  return {};
}

/**
 * Adds the value nodes the editor adds with an agent: the agent's defaults and its workspace.
 *
 * @remarks
 * The plan page binds every parameter with a default, and the directory
 * parameter without one to the plan's workspace, through a value node of its
 * own. An agent the workspace does not offer gets none; the graph check
 * refuses it when the plan is saved.
 */
function withAgentDefaults(
  plan: AgentPlanInput,
  step: AgentPlanStep,
  context: AgentPlanChangeContext,
): AgentPlanInput {
  const configuration = context.agents.find(
    (agent) => agent.id === step.agentId,
  )?.configuration;
  if (!configuration) return { ...plan, nodes: [...plan.nodes, step] };
  const values: AgentPlanParameter[] = [];
  const bindings = { ...step.bindings };
  for (const parameter of configuration.parameters) {
    const value =
      parameter.defaultValue ??
      (parameter.name === configuration.directoryParameter
        ? { type: "workspace" as const, workspaceId: plan.workspaceId }
        : null);
    if (!value) continue;
    const id = randomUUID();
    values.push({
      id,
      type: "parameter",
      name: parameter.name,
      format: value.type === "number" ? "number" : "string",
      value,
      x: bounded(step.x - COLUMN_WIDTH),
      y: bounded(step.y + ROW_HEIGHT + values.length * PARAMETER_ROW_HEIGHT),
    });
    bindings[parameter.name] = { kind: "source", nodeId: id };
  }
  return { ...plan, nodes: [...plan.nodes, { ...step, bindings }, ...values] };
}

function addNode(
  plan: AgentPlanInput,
  change: Extract<AgentPlanChange, { action: "addNode" }>,
  context: AgentPlanChangeContext,
): { plan: AgentPlanInput; id: string } {
  const id = change.id ?? randomUUID();
  if (plan.nodes.some((node) => node.id === id))
    throw refused("element_exists");
  const node = readPlanNode({
    ...nextPosition(plan),
    ...newNodeFields(change),
    ...change.fields,
    id,
    type: change.type,
  });
  requireFreeName(plan, node, null);
  if (node.type === "agent")
    return { plan: withAgentDefaults(plan, node, context), id };
  return { plan: { ...plan, nodes: [...plan.nodes, node] }, id };
}

function updateNode(
  plan: AgentPlanInput,
  change: Extract<AgentPlanChange, { action: "updateNode" }>,
): AgentPlanInput {
  const current = findNode(plan, change.nodeId);
  const settable = AGENT_PLAN_NODE_FIELDS[current.type];
  if (
    Object.keys(change.fields).some(
      (key) => key !== "x" && key !== "y" && !settable.includes(key),
    )
  )
    throw refused("element_missing");
  const node = readPlanNode({ ...current, ...change.fields, id: current.id });
  requireFreeName(plan, node, node.id);
  return replaceNode(plan, node);
}

function connect(
  plan: AgentPlanInput,
  change: Extract<AgentPlanChange, { action: "connect" | "disconnect" }>,
): AgentPlanInput {
  findNode(plan, change.from);
  findNode(plan, change.to);
  const exists = plan.edges.some(
    (edge) => edge.from === change.from && edge.to === change.to,
  );
  if (change.action === "connect") {
    if (exists) throw refused("element_exists");
    return {
      ...plan,
      edges: [
        ...plan.edges,
        {
          from: change.from,
          to: change.to,
          fromPort: "flow-out",
          toPort: "flow-in",
        },
      ],
    };
  }
  if (!exists) throw refused("element_missing");
  return {
    ...plan,
    edges: plan.edges.filter(
      (edge) => edge.from !== change.from || edge.to !== change.to,
    ),
  };
}

function bindInput(
  plan: AgentPlanInput,
  change: Extract<AgentPlanChange, { action: "bind" | "unbind" }>,
): AgentPlanInput {
  const step = findStep(plan, change.nodeId);
  if (change.action === "bind")
    return replaceNode(plan, {
      ...step,
      bindings: { ...step.bindings, [change.parameter]: change.binding },
    });
  if (!Object.hasOwn(step.bindings, change.parameter))
    throw refused("element_missing");
  return replaceNode(plan, {
    ...step,
    bindings: Object.fromEntries(
      Object.entries(step.bindings).filter(
        ([name]) => name !== change.parameter,
      ),
    ),
  });
}

/**
 * Applies changes of nodes, flow connections and inputs to a plan, in order.
 *
 * @param plan - The plan as it was read.
 * @param changes - The changes of the call.
 * @param context - The agents an added agent node takes its defaults from.
 * @returns The changed plan, not yet checked as a whole.
 * @throws {AgentOperationError} `INVALID_REQUEST` with `element_missing` or
 * `element_exists` for a change that names what the plan does not have or
 * already has, and the refusals of the node parser for a malformed node.
 *
 * @remarks
 * Removing a node removes its connections and the inputs it fed, as on the
 * plan page. Whether the result is a valid graph is decided when it is saved.
 */
export function applyPlanChanges(
  plan: AgentPlanInput,
  changes: readonly AgentPlanChange[],
  context: AgentPlanChangeContext,
): AgentPlanChangeResult {
  let current = plan;
  const createdNodeIds: string[] = [];
  for (const change of changes) {
    if (change.action === "addNode") {
      const added = addNode(current, change, context);
      current = added.plan;
      createdNodeIds.push(added.id);
    } else if (change.action === "updateNode")
      current = updateNode(current, change);
    else if (change.action === "removeNode") {
      findNode(current, change.nodeId);
      current = removePlanNode(current, change.nodeId);
    } else if (change.action === "connect" || change.action === "disconnect")
      current = connect(current, change);
    else current = bindInput(current, change);
  }
  return { plan: current, createdNodeIds };
}
