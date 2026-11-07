import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { PLAN_PORT } from "@/definition/AgentPlanBranching";
import {
  connectPlanBranching,
  disconnectPlanEdge,
  setPlanDecisionCondition,
} from "@/definition/AgentPlanBranchingEdit";
import { planConnectionIssues } from "@/definition/AgentPlanGraph";
import { connectPlanFlow } from "@/definition/AgentPlanGroupEdit";
import { joinPlanStack } from "@/definition/AgentPlanStackEdit";

import type { AgentDefinitionChoice } from "@/definition/AgentAvailability";
import type { AgentPlanEdge, AgentPlanInput } from "@/definition/AgentPlan";
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
 * The decision outputs `true-out`/`false-out` branch, the boolean result of an
 * agent becomes the one condition of a decision, a text result enters the
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
  const isBranch =
    fromPort === PLAN_PORT.trueOut || fromPort === PLAN_PORT.falseOut;
  if (isBranch && toPort === PLAN_PORT.flowIn)
    return connectPlanBranching(plan, {
      kind: "branch",
      from,
      branch: fromPort === PLAN_PORT.trueOut ? "true" : "false",
      to,
    });
  if (fromPort === PLAN_PORT.passedOut && toPort === PLAN_PORT.conditionIn)
    return setPlanDecisionCondition(plan, to, from);
  if (fromPort === PLAN_PORT.valueOut && toPort === PLAN_PORT.eventIn)
    return connectPlanBranching(plan, { kind: "event", from, to });
  return attemptFlowInput(plan, connection);
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
  const exists = plan.edges.some(
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
    return disconnectPlanEdge(plan, edge);
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
