import { DEFAULT_AGENT_RUN_OPTIONS } from "@/definition/AgentConfiguration";

import { agent } from "./plan-fixtures";

import type { AgentDefinitionChoice } from "@/definition/AgentAvailability";
import type { AgentProviderId } from "@/definition/AgentConnection";
import type {
  AgentPlanBinding,
  AgentPlanDecision,
  AgentPlanInput,
  AgentPlanNode,
  AgentPlanStep,
} from "@/definition/AgentPlan";
import type { AgentPlanGitCloseout } from "@/definition/AgentPlanGitCloseout";
import type { AgentPlanGroup } from "@/definition/AgentPlanGroup";
import type { PlanGroupMove } from "@/definition/AgentPlanGroupEdit";

/** Builders and readers shared by the group edit tests. */
export function choice(
  id: string,
  provider: AgentProviderId | null,
): AgentDefinitionChoice {
  return {
    id,
    name: id,
    model: "model",
    reasoningEffort: null,
    provider,
    purposes: [],
    revision: 1,
    configuration: {
      scope: "person",
      tag: "",
      markdown: "",
      projectId: null,
      accessMode: "personal",
      parameters: [],
      directoryParameter: null,
      run: DEFAULT_AGENT_RUN_OPTIONS,
    },
    availability: { isUsable: true, reason: null, personalChoices: [] },
  };
}

export const AGENTS = [
  choice("codex", "codex_cli"),
  choice("claude", "claude_code"),
  choice("api", "openrouter"),
  choice("blank", null),
];

/** An agent node of the given source agent. */
export function member(
  id: string,
  agentId = "codex",
  bindings: Record<string, AgentPlanBinding> = {},
): AgentPlanStep {
  return { ...agent(id, bindings), agentId };
}

/** A decision node on the grid origin. */
export function decision(id: string): AgentPlanDecision {
  return { id, type: "decision", x: 0, y: 0 };
}

/** A Git closeout node on the grid origin. */
export function closeout(id: string): AgentPlanGitCloseout {
  return {
    id,
    type: "git_closeout",
    name: id,
    role: "closeout",
    checkCommand: "true",
    timeoutSeconds: 60,
    x: 0,
    y: 0,
    bindings: {},
  };
}

/** The node with the id; fails the test when there is none. */
export function nodeOf(plan: AgentPlanInput, id: string): AgentPlanNode {
  const node = plan.nodes.find((entry) => entry.id === id);
  if (!node) throw new Error(`No node ${id}`);
  return node;
}

/** The group with the id; fails the test when the node is none. */
export function groupIn(plan: AgentPlanInput, id: string): AgentPlanGroup {
  const node = nodeOf(plan, id);
  if (node.type !== "group") throw new Error(`${id} is no group`);
  return node;
}

/** The ids of the agents of a group, in order. */
export function stepIds(group: AgentPlanGroup): string[] {
  return group.steps.map((step) => step.id);
}

/** Edges as `from>to` texts. */
export function pairs(edges: AgentPlanInput["edges"] | undefined): string[] {
  return (edges ?? []).map((entry) => `${entry.from}>${entry.to}`);
}

/** The move a placement made; fails the test for a refusal. */
export function moveOf<Plan extends AgentPlanInput>(
  result: PlanGroupMove<Plan> | string,
): PlanGroupMove<Plan> {
  if (typeof result === "string") throw new Error(`Refused: ${result}`);
  return result;
}

export const TEXT_HELLO: AgentPlanBinding = {
  kind: "literal",
  value: { type: "text", text: "hello" },
};
