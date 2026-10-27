import { emptyPlanLoop } from "@/definition/AgentPlanLoop";

import type {
  AgentPlanBinding,
  AgentPlanEdge,
  AgentPlanInput,
  AgentPlanNode,
  AgentPlanStep,
} from "@/definition/AgentPlan";
import type { AgentPlanGroup } from "@/definition/AgentPlanGroup";
import type { AgentPlanLoop } from "@/definition/AgentPlanLoop";
import type { AgentPlanScript } from "@/definition/AgentPlanScript";

/** Small plan builders shared by the plan definition tests. */
/** The input bindings of a node. */
export type Bindings = Record<string, AgentPlanBinding>;

/** An agent node on the grid at the given horizontal position. */
export function agent(
  id: string,
  bindings: Bindings = {},
  x = 0,
): AgentPlanStep {
  return {
    id,
    type: "agent",
    agentId: "agent-1",
    personalAgentId: null,
    instruction: "",
    x,
    y: 0,
    bindings,
  };
}

/** A script node with the given bindings. */
export function script(id: string, bindings: Bindings = {}): AgentPlanScript {
  return {
    id,
    type: "script",
    name: id,
    interpreterProfileId: "shell",
    content: "true",
    inputs: [],
    outputs: [],
    timeoutSeconds: 60,
    x: 0,
    y: 0,
    bindings,
  };
}

/** A flow edge between two nodes. */
export function edge(from: string, to: string): AgentPlanEdge {
  return { from, to, fromPort: "out", toPort: "in" };
}

/** A loop holding the given members, flow edges and deviations. */
export function loopOf(
  id: string,
  steps: AgentPlanLoop["steps"],
  edges: AgentPlanEdge[] = [],
  overrides: Partial<AgentPlanLoop> = {},
): AgentPlanLoop {
  return {
    ...emptyPlanLoop(id, id, { x: 0, y: 0 }),
    steps,
    edges,
    ...overrides,
  };
}

/** A group of agent nodes. */
export function groupOf(id: string, steps: AgentPlanStep[]): AgentPlanGroup {
  return {
    id,
    type: "group",
    name: id,
    x: 0,
    y: 0,
    steps,
    parameters: [],
    bindings: {},
  };
}

/** A plan holding the given nodes and outer flow edges. */
export function planOf(
  nodes: AgentPlanInput["nodes"],
  edges: AgentPlanEdge[] = [],
): AgentPlanInput {
  return {
    name: "Plan",
    workspaceId: "workspace",
    usage: "private",
    globals: {},
    nodes,
    edges,
  };
}

/** A start or end node of the flow. */
export function boundary(id: string, type: "start" | "end"): AgentPlanNode {
  return { id, type, x: 0, y: 0 };
}
