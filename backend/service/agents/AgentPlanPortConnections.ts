import { AgentOperationError } from "@/backend/error/AgentOperationError";
import {
  PLAN_PORT,
  planContainedEdges,
  planEdgeBranch,
} from "@/definition/AgentPlanBranching";
import {
  connectPlanBranching,
  disconnectPlanEdge,
  setPlanDecisionCondition,
  setPlanDecisionInput,
} from "@/definition/AgentPlanBranchingEdit";
import { findPlanDecision } from "@/definition/AgentPlanDecisionEdit";
import { planConnectionIssues } from "@/definition/AgentPlanGraph";
import {
  connectPlanFlow,
  findPlanBindingTarget,
  replacePlanNode,
} from "@/definition/AgentPlanGroupEdit";
import {
  PLAN_JUMP_PORT,
  PLAN_SIGNAL_PAYLOAD_BINDING,
  isPlanJumpOut,
  planPortType,
} from "@/definition/AgentPlanJump";
import { joinPlanStack } from "@/definition/AgentPlanStackEdit";

import type { AgentDefinitionChoice } from "@/definition/AgentAvailability";
import type {
  AgentPlanBinding,
  AgentPlanEdge,
  AgentPlanEnd,
  AgentPlanInput,
  AgentPlanStep,
} from "@/definition/AgentPlan";
import type { AgentPlanGitCloseout } from "@/definition/AgentPlanGitCloseout";
import type { AgentPlanIssue } from "@/definition/AgentPlanGraph";
import type {
  AgentPlanJumpOut,
  AgentPlanSignal,
} from "@/definition/AgentPlanJump";
import type { AgentPlanScript } from "@/definition/AgentPlanScript";
import type { AgentPlanChangePorts } from "./AgentPlanOperationInput";

/** The prefix of the input port of a node with named inputs; the editor draws `input:<name>`. */
const INPUT_PORT_PREFIX = "input:";

/** A connection between two nodes through the ports the editor names. */
export interface AgentPlanPortConnection {
  readonly action: "connect" | "disconnect";
  readonly from: string;
  readonly to: string;
  readonly ports: AgentPlanChangePorts;
}

/** The plan with the new edge, or the finding that refuses it. */
type PortAttempt = AgentPlanInput | AgentPlanIssue;

function issueKey(issue: AgentPlanIssue): string {
  return `${issue.nodeId ?? ""}|${issue.port ?? ""}|${issue.reason}`;
}

function edgeOf(connection: AgentPlanPortConnection): AgentPlanEdge {
  return {
    from: connection.from,
    to: connection.to,
    fromPort: connection.ports.fromPort,
    toPort: connection.ports.toPort,
  };
}

function typeIssue(connection: AgentPlanPortConnection): AgentPlanIssue {
  return {
    nodeId: connection.to,
    port: connection.ports.toPort,
    reason: "type",
  };
}

/** Refuses a connection with its finding, as the editor names it on the canvas. */
function refusedConnection(issue: AgentPlanIssue): AgentOperationError {
  return new AgentOperationError("INVALID_REQUEST", {
    reason: "graph_invalid",
    issues: [{ nodeId: issue.nodeId, port: issue.port, problem: issue.reason }],
  });
}

/** A ticket or value node dropped into a stack becomes its last entry, as on the canvas. */
function joinStack(
  plan: AgentPlanInput,
  connection: AgentPlanPortConnection,
): PortAttempt {
  const joined = joinPlanStack(plan, connection.to, connection.from);
  return typeof joined === "string" ? typeIssue(connection) : joined.plan;
}

/**
 * Builds the edge of a port connection with the functions the editor uses.
 *
 * @remarks
 * The decision outputs `true-out`/`false-out` and `case:<id>`, and the
 * failure outputs `error-out`/`timeout-out` of a calling Jump, branch, the
 * boolean result of an agent becomes the one condition of a decision, a
 * boolean parameter, a ticket or a text result becomes its bound data input,
 * a text result enters the
 * event input of an agent, a ticket or value node joins a stack through its
 * only input, and `flow-out` into `flow-in` is a plain flow edge. Any other
 * pair of ports carries nothing the plan understands.
 */
function attemptPorts(
  plan: AgentPlanInput,
  connection: AgentPlanPortConnection,
): PortAttempt {
  const { from, to, ports } = connection;
  const { fromPort, toPort } = ports;
  const branch = planEdgeBranch({ fromPort });
  if (branch !== null && toPort === PLAN_PORT.flowIn)
    return connectPlanBranching(plan, { kind: "branch", from, branch, to });
  if (fromPort === PLAN_PORT.passedOut && toPort === PLAN_PORT.conditionIn)
    return setPlanDecisionCondition(plan, to, from);
  if (fromPort === PLAN_PORT.valueOut && toPort === PLAN_PORT.conditionIn)
    return attemptDecisionInput(plan, connection);
  if (fromPort === PLAN_PORT.valueOut && toPort === PLAN_PORT.eventIn)
    return connectPlanBranching(plan, { kind: "event", from, to });
  return attemptFlowInput(plan, connection);
}

/** The bound input of a decision the connection names, as the editor draws it from `value-out` to `condition-in`. */
function decisionInputOf(
  plan: AgentPlanInput,
  connection: AgentPlanPortConnection,
): AgentPlanBinding | null {
  const { fromPort, toPort } = connection.ports;
  if (fromPort !== PLAN_PORT.valueOut || toPort !== PLAN_PORT.conditionIn)
    return null;
  const input = findPlanDecision(plan, connection.to)?.decision.input;
  if (!input) return null;
  const source = input.kind === "source" ? input.nodeId : null;
  const result = input.kind === "result" ? input.stepId : null;
  return source === connection.from || result === connection.from
    ? input
    : null;
}

/** A parameter or ticket node, or the text result of an agent or script, becomes the data input of a decision. */
function attemptDecisionInput(
  plan: AgentPlanInput,
  connection: AgentPlanPortConnection,
): PortAttempt {
  const { from, to } = connection;
  if (!findPlanDecision(plan, to)) return typeIssue(connection);
  const source = plan.nodes.find((node) => node.id === from);
  const isValue = source?.type === "parameter" || source?.type === "task";
  return setPlanDecisionInput(
    plan,
    to,
    isValue
      ? { kind: "source", nodeId: from }
      : { kind: "result", stepId: from },
  );
}

/** A ticket or value node into a stack, or a control output into a flow input. */
function attemptFlowInput(
  plan: AgentPlanInput,
  connection: AgentPlanPortConnection,
): PortAttempt {
  const { from, to, ports } = connection;
  if (ports.toPort !== PLAN_PORT.flowIn) return typeIssue(connection);
  const target = plan.nodes.find((node) => node.id === to);
  if (target?.type === "stack" && ports.fromPort === PLAN_PORT.valueOut)
    return joinStack(plan, connection);
  if (ports.fromPort !== PLAN_PORT.flowOut) return typeIssue(connection);
  const connected = connectPlanFlow(plan, from, to);
  return typeof connected === "string"
    ? { nodeId: to, port: ports.toPort, reason: connected }
    : connected;
}

/** The nodes that hold bindings other than the agents' own: a calling Jump, a signal and an end. */
type CallHolder = AgentPlanJumpOut | AgentPlanSignal | AgentPlanEnd;

/** A node whose named inputs a value port can fill. */
type ValueHolder =
  | AgentPlanStep
  | AgentPlanScript
  | AgentPlanGitCloseout
  | CallHolder;

/** A value port connected to a named input: the node and input it fills, and the binding it makes. */
interface ValueConnection {
  readonly holder: ValueHolder;
  readonly name: string;
  readonly binding: Extract<AgentPlanBinding, { kind: "port" }>;
}

/** The input a port names: `input:<name>`, or the payload input of a signal. */
function inputNameOf(toPort: string): string | null {
  if (toPort === PLAN_JUMP_PORT.payloadIn) return PLAN_SIGNAL_PAYLOAD_BINDING;
  return toPort.startsWith(INPUT_PORT_PREFIX)
    ? toPort.slice(INPUT_PORT_PREFIX.length)
    : null;
}

/** The node whose input bindings a value connection changes; frames and decisions hold none. */
function valueHolder(plan: AgentPlanInput, id: string): ValueHolder | null {
  const member = findPlanBindingTarget(plan, id);
  if (member && member.type !== "group" && member.type !== "loop")
    return member;
  const node = plan.nodes.find((entry) => entry.id === id);
  if (node?.type === "signal" || node?.type === "end" || isPlanJumpOut(node))
    return node;
  return null;
}

/**
 * The binding a value port connection makes, or `null` when the connection is no value connection.
 * @remarks
 * The output must be a value port the source really has (`planPortType`) and
 * the input one the target holds; any other pair is refused like every
 * other pair of ports that carries nothing the plan understands.
 */
function valueConnectionOf(
  plan: AgentPlanInput,
  connection: AgentPlanPortConnection,
): ValueConnection | null {
  const { from, to, ports } = connection;
  const name = inputNameOf(ports.toPort);
  const holder = valueHolder(plan, to);
  if (name === null || holder === null) return null;
  if (planPortType(plan, from, ports.fromPort) === null) return null;
  return {
    holder,
    name,
    binding: { kind: "port", nodeId: from, port: ports.fromPort },
  };
}

/** The holder with one binding set, or removed with `null`. */
function withValueBinding(
  plan: AgentPlanInput,
  value: Pick<ValueConnection, "holder" | "name">,
  binding: AgentPlanBinding | null,
): AgentPlanInput {
  const kept = Object.fromEntries(
    Object.entries(value.holder.bindings ?? {}).filter(
      ([name]) => name !== value.name,
    ),
  );
  return replacePlanNode(plan, {
    ...value.holder,
    bindings: binding === null ? kept : { ...kept, [value.name]: binding },
  });
}

/** Connects or disconnects a value port; an input has one source, so a filled one is refused. */
function applyValueConnection(
  plan: AgentPlanInput,
  connection: AgentPlanPortConnection,
  value: ValueConnection,
): AgentPlanInput {
  const current = value.holder.bindings?.[value.name];
  if (connection.action === "connect") {
    if (current !== undefined)
      throw new AgentOperationError("INVALID_REQUEST", {
        reason: "element_exists",
      });
    return withValueBinding(plan, value, value.binding);
  }
  const { binding } = value;
  if (
    current?.kind !== "port" ||
    current.nodeId !== binding.nodeId ||
    current.port !== binding.port
  )
    throw new AgentOperationError("INVALID_REQUEST", {
      reason: "element_missing",
    });
  return withValueBinding(plan, value, null);
}

/** The attempt, unless it adds a finding the plan did not have; only what the new edge adds counts. */
function requireNoNewIssues(
  plan: AgentPlanInput,
  attempt: AgentPlanInput,
  agents: readonly AgentDefinitionChoice[],
): AgentPlanInput {
  const known = new Set(planConnectionIssues(plan, agents).map(issueKey));
  const issue = planConnectionIssues(attempt, agents).find(
    (entry) => !known.has(issueKey(entry)),
  );
  if (issue) throw refusedConnection(issue);
  return attempt;
}

/**
 * Adds or removes one edge named by its nodes and ports.
 *
 * @param plan - The plan as the changes left it so far.
 * @param connection - The change with both ports.
 * @param agents - The agents of the plan's workspace, for the connection check.
 * @returns The changed plan.
 * @throws {AgentOperationError} `INVALID_REQUEST` with `element_exists` for an
 * edge the plan already has, `element_missing` for removing one it does not
 * have, and `graph_invalid` with the finding of `planConnectionIssues` for a
 * connection the editor refuses.
 *
 * @remarks
 * As in the editor, only what the new edge adds counts: findings the plan
 * already had do not block it. A stack entry is data of the stack, not an
 * edge, so it leaves the stack through a change of the stack's entries.
 * A value port of a start or a Jump (`entry:<name>`, `run-id-out`,
 * `reason-out`, `payload-out`, `return:<name>`) connected to `input:<name>`
 * of a node with inputs, or to `payload-in` of a signal, is no edge either:
 * it is the `port` binding of that input.
 */
export function applyPlanPortConnection(
  plan: AgentPlanInput,
  connection: AgentPlanPortConnection,
  agents: readonly AgentDefinitionChoice[],
): AgentPlanInput {
  const value = valueConnectionOf(plan, connection);
  if (value) {
    const bound = applyValueConnection(plan, connection, value);
    return connection.action === "connect"
      ? requireNoNewIssues(plan, bound, agents)
      : bound;
  }
  const edge = edgeOf(connection);
  const input = decisionInputOf(plan, connection);
  const exists =
    input !== null ||
    planContainedEdges(plan).some(
      (entry) =>
        entry.from === edge.from &&
        entry.to === edge.to &&
        entry.fromPort === edge.fromPort &&
        entry.toPort === edge.toPort,
    );
  if (connection.action === "disconnect") {
    if (!exists)
      throw new AgentOperationError("INVALID_REQUEST", {
        reason: "element_missing",
      });
    return input === null
      ? disconnectPlanEdge(plan, edge)
      : setPlanDecisionInput(plan, connection.to, null);
  }
  if (exists)
    throw new AgentOperationError("INVALID_REQUEST", {
      reason: "element_exists",
    });
  const attempt = attemptPorts(plan, connection);
  if (!("nodes" in attempt)) throw refusedConnection(attempt);
  return requireNoNewIssues(plan, attempt, agents);
}
