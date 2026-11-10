import { script } from "./plan-fixtures";
import { choice, configured } from "./plan-graph-fixtures";

import type {
  AgentPlanDecision,
  AgentPlanEdge,
  AgentPlanNode,
  AgentPlanParameter,
  AgentPlanStep,
} from "@/definition/AgentPlan";
import type { AgentDefinitionChoice } from "@/definition/AgentAvailability";
import type { AgentPlanIssue } from "@/definition/AgentPlanGraph";

/** Plan builders shared by the tests of the branching graph checks. */
export const AGENTS: readonly AgentDefinitionChoice[] = [choice("agent-1")];

/** An edge between two named ports. */
export function edgeOf(
  from: string,
  fromPort: string,
  to: string,
  toPort: string,
): AgentPlanEdge {
  return { from, to, fromPort, toPort };
}

/** A flow edge. */
export function flow(from: string, to: string): AgentPlanEdge {
  return edgeOf(from, "flow-out", to, "flow-in");
}

/** The boolean result of an agent entering the condition input of a decision. */
export function passed(from: string, to: string): AgentPlanEdge {
  return edgeOf(from, "passed-out", to, "condition-in");
}

/** The text result of a node returning to the event input of an agent. */
export function event(from: string, to: string): AgentPlanEdge {
  return edgeOf(from, "value-out", to, "event-in");
}

/** An edge leaving the given output port of a decision. */
export function branch(from: string, port: string, to: string): AgentPlanEdge {
  return edgeOf(from, port, to, "flow-in");
}

/** A boolean decision. */
export function decision(
  id: string,
  extra: Partial<AgentPlanDecision> = {},
): AgentPlanDecision {
  return { id, type: "decision", x: 0, y: 0, ...extra };
}

/** A complete model decision with a question and an ACP model. */
export function modelDecision(
  id: string,
  extra: Partial<AgentPlanDecision> = {},
): AgentPlanDecision {
  return decision(id, {
    mode: "model",
    question: "Is it fine?",
    model: {
      connectionId: "connection",
      provider: "claude_code",
      model: "m",
      reasoningEffort: null,
    },
    ...extra,
  });
}

/** An agent that carries a Claude Code configuration of its own. */
export function agentNode(
  id: string,
  overrides: Partial<AgentPlanStep> = {},
): AgentPlanStep {
  return configured(id, [], { overrides });
}

/** A ticket node. */
export function taskNode(id: string): AgentPlanNode {
  return { id, type: "task", taskId: "ticket", x: 0, y: 0 };
}

/** A parameter node holding `true`, of the given format. */
export function booleanParameter(
  id: string,
  format: AgentPlanParameter["format"] = "boolean",
): AgentPlanParameter {
  return {
    id,
    type: "parameter",
    name: id,
    format,
    value: { type: "text", text: "true" },
    x: 0,
    y: 0,
  };
}

/** A script that declares exactly one output. */
export function oneOutput(id: string): AgentPlanNode {
  return { ...script(id), outputs: [{ name: "result", type: "text" }] };
}

/** Compact `node:port:reason` texts of issues, for readable assertions. */
export function reasons(issues: readonly AgentPlanIssue[]): string[] {
  return issues.map((issue) => `${issue.nodeId}:${issue.port}:${issue.reason}`);
}
