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
import { connectPlanFlow } from "@/definition/AgentPlanGroupEdit";
import { joinPlanStack } from "@/definition/AgentPlanStackEdit";

import type { AgentDefinitionChoice } from "@/definition/AgentAvailability";
import type {
  AgentPlanBinding,
  AgentPlanEdge,
  AgentPlanInput,
} from "@/definition/AgentPlan";
import type { AgentPlanIssue } from "@/definition/AgentPlanGraph";
import type { AgentPlanChangePorts } from "./AgentPlanOperationInput";

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
 * The decision outputs `true-out`/`false-out` and `case:<id>` branch, the
 * boolean result of an agent becomes the one condition of a decision, a
 * boolean parameter, a ticket or a text result becomes its bound data input
 * (PAGE-286), a text result enters the
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
 */
export function applyPlanPortConnection(
  plan: AgentPlanInput,
  connection: AgentPlanPortConnection,
  agents: readonly AgentDefinitionChoice[],
): AgentPlanInput {
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
  const known = new Set(planConnectionIssues(plan, agents).map(issueKey));
  const issue = planConnectionIssues(attempt, agents).find(
    (entry) => !known.has(issueKey(entry)),
  );
  if (issue) throw refusedConnection(issue);
  return attempt;
}
