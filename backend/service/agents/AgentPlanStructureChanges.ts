import { randomUUID } from "node:crypto";

import {
  connectPlanFlow,
  disconnectPlanGroupFlow,
  placePlanStep,
  replacePlanNode,
  ungroupPlanGroup,
} from "@/definition/AgentPlanGroupEdit";
import { emptyPlanLoop } from "@/definition/AgentPlanLoop";
import { findPlanBindingTarget } from "@/definition/AgentPlanGroupEdit";
import {
  disconnectLoopFlow,
  findPlanNodeLocation,
  placePlanLoopNode,
  ungroupPlanLoop,
} from "@/definition/AgentPlanLoopEdit";
import { planGroupEdges } from "@/definition/AgentPlanGroup";
import {
  copyPlanConfiguration,
  planConfigurationForModel,
} from "@/definition/AgentPlanConfiguration";
import { PLAN_SCRIPT_TIMEOUT } from "@/definition/AgentPlanScript";
import { readPlanNode } from "@/backend/agents/AgentPlanInput";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { removePlanNode } from "@/definition/AgentPlanGraph";

import {
  patchPlanConfiguration,
  selectedPlanModel,
} from "./AgentPlanConfigurationChanges";
import { AGENT_PLAN_NODE_FIELDS } from "./AgentPlanOperationInput";

import type { AgentPlanLoop } from "@/definition/AgentPlanLoop";
import type { PageAgentModel } from "@/definition/PageAgent";
import type { AgentPlanTemplateNode } from "@/definition/AgentPlanNodeTemplate";
import type { AgentDefinitionChoice } from "@/definition/AgentAvailability";
import type {
  AgentPlanInput,
  AgentPlanNode,
  AgentPlanParameter,
  AgentPlanStep,
} from "@/definition/AgentPlan";
import type { AgentPlanScript } from "@/definition/AgentPlanScript";
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
  readonly models?: readonly PageAgentModel[];
  readonly templates?: ReadonlyMap<AgentPlanChange, AgentPlanTemplateNode>;
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
  const node =
    plan.nodes.find((entry) => entry.id === id) ??
    findPlanBindingTarget(plan, id);
  if (!node) throw refused("element_missing");
  return node;
}

/** The node whose inputs a binding fills: an agent (also a group member) or a script. */
function findInputNode(
  plan: AgentPlanInput,
  id: string,
): AgentPlanStep | AgentPlanScript | AgentPlanLoop {
  const node = findNode(plan, id);
  if (node.type !== "agent" && node.type !== "script" && node.type !== "loop")
    throw refused("element_missing");
  return node;
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
  if (change.type === "loop")
    return { ...emptyPlanLoop("", "", { x: 0, y: 0 }) };
  if (change.type === "agent")
    return { personalAgentId: null, instruction: "", bindings: {} };
  if (change.type === "group")
    return { steps: [], edges: [], parameters: [], bindings: {} };
  if (change.type === "parameter")
    return { format: defaultFormat(change.fields.value) };
  // As in the script dialog: no inputs and the default timeout until named.
  if (change.type === "script")
    return {
      inputs: [],
      timeoutSeconds: PLAN_SCRIPT_TIMEOUT.initial,
      bindings: {},
    };
  return {};
}

/**
 * An edited node keeps the connections of the inputs it still declares.
 *
 * @remarks
 * The node dialogs drop the connection of a removed input as well; a
 * renamed input is a new one here and needs to be bound again.
 */
function withDeclaredBindings(node: AgentPlanNode): AgentPlanNode {
  if (node.type !== "script" && node.type !== "agent") return node;
  const parameters =
    node.type === "script"
      ? node.inputs
      : node.configuration?.template.parameters;
  if (!parameters) return node;
  const names = new Set(parameters.map((input) => input.name));
  return {
    ...node,
    bindings: Object.fromEntries(
      Object.entries(node.bindings).filter(([name]) => names.has(name)),
    ),
  };
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
  const agent = context.agents.find((entry) => entry.id === step.agentId);
  const copied =
    step.configuration ?? (agent ? copyPlanConfiguration(agent) : null);
  if (!copied) return { ...plan, nodes: [...plan.nodes, step] };
  step = { ...step, configuration: copied };
  const configuration = copied.template;
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

function addNode(
  plan: AgentPlanInput,
  change: Extract<AgentPlanChange, { action: "addNode" }>,
  context: AgentPlanChangeContext,
): { plan: AgentPlanInput; id: string } {
  const id = change.id ?? randomUUID();
  if (
    plan.nodes.some((node) => node.id === id) ||
    findPlanBindingTarget(plan, id)
  )
    throw refused("element_exists");
  const { configuration, ...fields } = change.fields;
  const node = readPlanNode({
    ...nextPosition(plan),
    ...newNodeFields(change),
    ...(change.type === "agent" ? { agentId: id } : {}),
    ...(change.type === "agent" &&
    fields.agentId === undefined &&
    configuration !== undefined
      ? {
          configuration: planConfigurationForModel(
            selectedPlanModel(configuration, context),
          ),
        }
      : {}),
    ...fields,
    id,
    type: change.type,
  });
  requireFreeName(plan, node, null);
  if (node.type === "agent") {
    const added = withAgentDefaults(plan, node, context);
    return {
      plan:
        configuration === undefined
          ? added
          : updateNode(
              added,
              { action: "updateNode", nodeId: id, fields: { configuration } },
              context,
            ),
      id,
    };
  }
  return { plan: { ...plan, nodes: [...plan.nodes, node] }, id };
}

function updateNode(
  plan: AgentPlanInput,
  change: Extract<AgentPlanChange, { action: "updateNode" }>,
  context: AgentPlanChangeContext,
): AgentPlanInput {
  const current = findNode(plan, change.nodeId);
  const settable = AGENT_PLAN_NODE_FIELDS[current.type];
  if (
    Object.keys(change.fields).some(
      (key) => key !== "x" && key !== "y" && !settable.includes(key),
    )
  )
    throw refused("element_missing");
  const { configuration, ...fields } = change.fields;
  let node = reassignedNode(
    current,
    withDeclaredBindings(
      readPlanNode({ ...current, ...fields, id: current.id }),
    ),
    context,
  );
  if (configuration !== undefined && node.type === "agent")
    node = readPlanNode({
      ...node,
      configuration: patchPlanConfiguration(node, configuration, context),
    });
  requireFreeName(plan, node, node.id);
  return replacePlanNode(plan, node);
}

function reassignedNode(
  current: AgentPlanNode,
  node: AgentPlanNode,
  context: AgentPlanChangeContext,
): AgentPlanNode {
  if (current.type !== "agent" || node.type !== "agent") return node;
  if (current.agentId !== node.agentId) {
    const source = context.agents.find((agent) => agent.id === node.agentId);
    return {
      ...node,
      configuration: source ? copyPlanConfiguration(source) : undefined,
    };
  }
  if (current.personalAgentId !== node.personalAgentId && node.configuration)
    return {
      ...node,
      configuration: {
        ...node.configuration,
        modelProfileId: node.personalAgentId ?? "",
      },
    };
  return node;
}

function connect(
  plan: AgentPlanInput,
  change: Extract<AgentPlanChange, { action: "connect" | "disconnect" }>,
): AgentPlanInput {
  findNode(plan, change.from);
  findNode(plan, change.to);
  const edges = [
    ...plan.edges,
    ...plan.nodes.flatMap((node) => (node.type === "loop" ? node.edges : [])),
    ...plan.nodes.flatMap((node) =>
      node.type === "group" ? planGroupEdges(node) : [],
    ),
  ];
  const exists = edges.some(
    (edge) => edge.from === change.from && edge.to === change.to,
  );
  if (change.action === "connect") {
    if (exists) throw refused("element_exists");
    const connected = connectPlanFlow(plan, change.from, change.to);
    if (typeof connected === "string") throw refused("graph_invalid");
    return connected;
  }
  if (!exists) throw refused("element_missing");
  let disconnected = {
    ...plan,
    edges: plan.edges.filter(
      (edge) => edge.from !== change.from || edge.to !== change.to,
    ),
  };
  for (const node of plan.nodes)
    if (node.type === "group")
      disconnected = disconnectPlanGroupFlow(disconnected, node.id, change);
    else if (node.type === "loop")
      disconnected = disconnectLoopFlow(disconnected, node.id, change);
  return disconnected;
}

function bindInput(
  plan: AgentPlanInput,
  change: Extract<AgentPlanChange, { action: "bind" | "unbind" }>,
): AgentPlanInput {
  const step = findInputNode(plan, change.nodeId);
  if (change.action === "bind")
    return replacePlanNode(plan, {
      ...step,
      bindings: { ...step.bindings, [change.parameter]: change.binding },
    });
  if (!Object.hasOwn(step.bindings, change.parameter))
    throw refused("element_missing");
  return replacePlanNode(plan, {
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
      current = updateNode(current, change, context);
    else if (change.action === "removeNode") {
      findNode(current, change.nodeId);
      current = removePlanNode(current, change.nodeId);
    } else if (change.action === "connect" || change.action === "disconnect")
      current = connect(current, change);
    else if (change.action === "bind" || change.action === "unbind")
      current = bindInput(current, change);
    else {
      const result = applyMembershipChange(current, change, context);
      current = result.plan;
      createdNodeIds.push(...result.createdNodeIds);
    }
  }
  return { plan: current, createdNodeIds };
}

function applyMembershipChange(
  plan: AgentPlanInput,
  change: Extract<
    AgentPlanChange,
    { action: "placeNode" | "placeLoopNode" | "ungroup" | "insertTemplate" }
  >,
  context: AgentPlanChangeContext,
): AgentPlanChangeResult {
  if (change.action === "insertTemplate") {
    const node = context.templates?.get(change);
    if (!node) throw refused("element_missing");
    const copy = { ...node, x: change.x, y: change.y };
    return {
      plan: { ...plan, nodes: [...plan.nodes, copy] },
      createdNodeIds: [
        copy.id,
        ...(copy.type === "group" ? copy.steps.map((step) => step.id) : []),
      ],
    };
  }
  if (change.action === "placeNode" || change.action === "placeLoopNode")
    return placeMember(plan, change, context);
  if (change.action !== "ungroup") throw refused("graph_invalid");
  return ungroupContainer(plan, change);
}

function ungroupContainer(
  plan: AgentPlanInput,
  change: Extract<AgentPlanChange, { action: "ungroup" }>,
): AgentPlanChangeResult {
  const group = findNode(plan, change.nodeId);
  if (
    (group.type !== "group" && group.type !== "loop") ||
    change.positions.length !== group.steps.length ||
    new Set(change.positions.map((entry) => entry.nodeId)).size !==
      group.steps.length ||
    group.steps.some(
      (step) => !change.positions.some((entry) => entry.nodeId === step.id),
    )
  )
    throw refused("element_missing");
  const ungroup = group.type === "loop" ? ungroupPlanLoop : ungroupPlanGroup;
  const result = ungroup(plan, group.id, (step) => {
    const position =
      change.positions.find((entry) => entry.nodeId === step.id) ?? step;
    return { x: position.x, y: position.y };
  });
  if (result.plan.nodes.some((node) => node.id === group.id))
    throw refused("graph_invalid");
  return { plan: result.plan, createdNodeIds: [] };
}

function placeMember(
  plan: AgentPlanInput,
  change: Extract<AgentPlanChange, { action: "placeNode" | "placeLoopNode" }>,
  context: AgentPlanChangeContext,
): AgentPlanChangeResult {
  const location = findPlanNodeLocation(plan, change.nodeId);
  if (!location) throw refused("element_missing");
  if (
    !location.loop &&
    change.action === "placeLoopNode" &&
    change.groupId === null
  ) {
    if (!location.group)
      return {
        plan: replacePlanNode(plan, {
          ...location.node,
          x: change.x,
          y: change.y,
        }),
        createdNodeIds: [],
      };
    return placeMember(plan, { ...change, action: "placeNode" }, context);
  }
  if (location.loop && change.action === "placeNode") {
    plan = placeMember(
      plan,
      { ...change, action: "placeLoopNode", groupId: null },
      context,
    ).plan;
  }
  const result =
    change.action === "placeLoopNode"
      ? placePlanLoopNode(
          plan,
          {
            nodeId: change.nodeId,
            loopId: change.groupId,
            position: { x: change.x, y: change.y },
          },
          {
            agents: context.agents,
            detachFromGroup: (current, step, position) => {
              const detached = placePlanStep(
                current,
                { stepId: step.id, groupId: null, position },
                context.agents,
              );
              return typeof detached === "string" ? detached : detached.plan;
            },
          },
        )
      : placePlanStep(
          plan,
          {
            stepId: change.nodeId,
            groupId: change.groupId,
            position: { x: change.x, y: change.y },
          },
          context.agents,
        );
  if (typeof result === "string") throw refused("graph_invalid");
  return { plan: result.plan, createdNodeIds: [] };
}
