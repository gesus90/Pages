import {
  defaultAgentRunOptions,
  emptyAgentConfiguration,
} from "@/definition/AgentConfiguration";
import {
  planConnectionIssues,
  planExecutionIssues,
} from "@/definition/AgentPlanGraph";

import { agent, boundary, edge, planOf, script } from "./plan-fixtures";

import type { AgentDefinitionChoice } from "@/definition/AgentAvailability";
import type { AgentParameter } from "@/definition/AgentParameters";
import type {
  AgentPlanBinding,
  AgentPlanEdge,
  AgentPlanNode,
  AgentPlanStep,
} from "@/definition/AgentPlan";
import type { AgentPlanAssetFile } from "@/definition/AgentPlanAsset";
import type { AgentPlanGitCloseout } from "@/definition/AgentPlanGitCloseout";
import type { AgentPlanIssue } from "@/definition/AgentPlanGraph";
import type { AgentPlanScript } from "@/definition/AgentPlanScript";

/** Plan builders shared by the plan graph tests. */
export const FLOW = { fromPort: "flow-out", toPort: "flow-in" };

/** A flow edge between two nodes. */
export function flow(from: string, to: string): AgentPlanEdge {
  return { ...edge(from, to), ...FLOW };
}

/** One declared input of an agent or script. */
export function parameterOf(
  name: string,
  type: AgentParameter["type"],
  overrides: Partial<AgentParameter> = {},
): AgentParameter {
  return {
    name,
    type,
    description: "",
    isRequired: false,
    defaultValue: null,
    ...overrides,
  };
}

/** An agent that carries its own configuration with the given inputs. */
export function configured(
  id: string,
  parameters: AgentParameter[] = [],
  options: {
    readonly bindings?: Record<string, AgentPlanBinding>;
    readonly markdown?: string;
    readonly directoryParameter?: string | null;
    readonly overrides?: Partial<AgentPlanStep>;
  } = {},
): AgentPlanStep {
  return {
    ...agent(id, options.bindings),
    configuration: {
      name: "Agent",
      revision: 1,
      modelProfileId: "model",
      connectionId: "fixture-connection",
      model: "m",
      provider: "claude_code",
      reasoningEffort: null,
      template: {
        markdown: options.markdown ?? "",
        parameters,
        directoryParameter: options.directoryParameter ?? null,
        run: defaultAgentRunOptions("claude_code"),
      },
    },
    ...options.overrides,
  };
}

/** An agent the plan editor offers. */
export function choice(
  id: string,
  overrides: Partial<AgentDefinitionChoice> = {},
): AgentDefinitionChoice {
  return {
    id,
    name: id,
    model: "m",
    reasoningEffort: null,
    provider: "claude_code",
    purposes: [],
    revision: 1,
    configuration: emptyAgentConfiguration(),
    availability: { isUsable: true, reason: null, personalChoices: [] },
    ...overrides,
  };
}

/** A script with the given declared inputs. */
export function textScript(
  id: string,
  inputs: AgentPlanScript["inputs"],
  bindings: Record<string, AgentPlanBinding> = {},
): AgentPlanScript {
  return { ...script(id, bindings), inputs };
}

/** The removed Git closeout node. */
export function closeout(
  id: string,
  bindings: Record<string, AgentPlanBinding> = {},
): AgentPlanGitCloseout {
  return {
    id,
    type: "git_closeout",
    name: id,
    role: "closeout",
    checkCommand: "true",
    timeoutSeconds: 60,
    x: 0,
    y: 0,
    bindings,
  };
}

/** A text parameter node. */
export function parameterNode(
  id: string,
  text: string,
  name = id,
): AgentPlanNode {
  return {
    id,
    type: "parameter",
    name,
    format: "string",
    value: { type: "text", text },
    x: 0,
    y: 0,
  };
}

/** A number parameter node. */
export function numberNode(id: string, number: number): AgentPlanNode {
  return {
    id,
    type: "parameter",
    name: id,
    format: "number",
    value: { type: "number", number },
    x: 0,
    y: 0,
  };
}

/** A ticket node. */
export function ticketNode(id: string): AgentPlanNode {
  return { id, type: "task", taskId: "ticket-1", x: 0, y: 0 };
}

/** A variable node that names a global. */
export function variableNode(id: string, name: string): AgentPlanNode {
  return { id, type: "variable", name, x: 0, y: 0 };
}

/** The file of an asset node. */
export const FILE: AgentPlanAssetFile = {
  assetId: "asset-1",
  fileName: "notes.pdf",
  mediaType: "application/pdf",
  kind: "document",
  size: 12,
  digest: "abc",
};

/** An asset node, with or without a file. */
export function assetNode(
  id: string,
  file: AgentPlanAssetFile | null = FILE,
  name = "notes",
): AgentPlanNode {
  return { id, type: "asset", name, file, x: 0, y: 0 };
}

/** The start node. */
export const START = boundary("start", "start");
/** The end node. */
export const END = boundary("end", "end");

/** The issues of one node. */
export function of(
  issues: readonly AgentPlanIssue[],
  nodeId: string,
): readonly AgentPlanIssue[] {
  return issues.filter((issue) => issue.nodeId === nodeId);
}

/** The issues of the connection check for a plan of these nodes and edges. */
export function connection(
  nodes: AgentPlanNode[],
  edges: AgentPlanEdge[] = [],
  agents: readonly AgentDefinitionChoice[] = [],
): readonly AgentPlanIssue[] {
  return planConnectionIssues(planOf(nodes, edges), agents);
}

/** A plan that runs the nodes one after the other between start and end. */
export function execution(
  nodes: AgentPlanNode[],
  agents: readonly AgentDefinitionChoice[] = [],
  extra: AgentPlanNode[] = [],
  extraEdges: AgentPlanEdge[] = [],
): readonly AgentPlanIssue[] {
  const chain = [START, ...nodes, END];
  const edges = chain
    .slice(1)
    .map((node, index) => flow(chain[index].id, node.id));
  return planExecutionIssues(
    planOf([...chain, ...extra], [...edges, ...extraEdges]),
    agents,
  );
}

/** The issues the connection check names for one node. */
export function portIssues(
  step: AgentPlanNode,
  others: AgentPlanNode[] = [],
  edges: AgentPlanEdge[] = [],
): readonly AgentPlanIssue[] {
  return of(connection([step, ...others], edges), step.id);
}

/** The issues the check of the run names for one agent between start and end. */
export function missing(
  step: AgentPlanStep,
  extra: AgentPlanNode[] = [],
  agents: readonly AgentDefinitionChoice[] = [],
): readonly AgentPlanIssue[] {
  return of(execution([step], agents, extra), step.id);
}
