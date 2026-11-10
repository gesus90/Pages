import { PLAN_ADDABLE_TYPES } from "@/definition/AgentPlanChangeFields";
import { PLAN_GIT_CLOSEOUT_PARAMETERS } from "@/definition/AgentPlanGitCloseout";
import { planNodeParameters } from "@/definition/AgentPlanGroup";
import {
  PLAN_LOOP_RUNS_BINDING,
  PLAN_LOOP_WHILE_BINDING,
} from "@/definition/AgentPlanLoop";

import type { AgentDefinitionChoice } from "@/definition/AgentAvailability";
import type { AgentParameterType } from "@/definition/AgentParameters";
import type { AgentPlanInput, AgentPlanNode } from "@/definition/AgentPlan";

/**
 * The node types a notation writes: those the editor adds, the decision
 * among them, the asset whose file only the editor uploads, and the legacy
 * variable and Git closeout, so that every stored plan can be written back.
 */
export const PLAN_NOTATION_NODE_TYPES = [
  ...PLAN_ADDABLE_TYPES,
  "asset",
  "variable",
  "git_closeout",
] as const;

/** A node type of the notation. */
export type PlanNotationNodeType = (typeof PLAN_NOTATION_NODE_TYPES)[number];

/** DOT keywords; they are case-insensitive, as in Graphviz. */
export const PLAN_NOTATION_KEYWORDS: readonly string[] = [
  "digraph",
  "graph",
  "subgraph",
  "node",
  "edge",
  "strict",
];

/** The frame types of a `subgraph cluster_<id>`. */
export const PLAN_NOTATION_FRAME_TYPES = ["group", "loop"] as const;

/** The `in=` values that name the branching inputs instead of a data input. */
export const PLAN_NOTATION_CONDITION_INPUT = "condition";
export const PLAN_NOTATION_EVENT_INPUT = "event";

/** The prefix of a fixed value of an input, `in.<input>="<value>"`. */
export const PLAN_NOTATION_LITERAL_PREFIX = "in.";
/** The prefix of a binding written as JSON, `bind.<input>="<json>"`, for any binding the edges cannot say. */
export const PLAN_NOTATION_BINDING_PREFIX = "bind.";
/** The prefix of a plan global, `global.<key>="<value>"`. */
export const PLAN_NOTATION_GLOBAL_PREFIX = "global.";

/** The `out=` word of each data output of a stack. */
export const PLAN_NOTATION_STACK_OUTPUTS = {
  entry: "content",
  count: "count",
} as const;

/** The input of a loop that takes the number of iterations, and the one of a while loop. */
const LOOP_INPUTS: Readonly<Record<string, AgentParameterType | null>> = {
  [PLAN_LOOP_RUNS_BINDING]: "number",
  [PLAN_LOOP_WHILE_BINDING]: null,
};

/** Whether a text names a node type of the notation. */
export function isPlanNotationNodeType(
  text: string,
): text is PlanNotationNodeType {
  return PLAN_NOTATION_NODE_TYPES.some((type) => type === text);
}

/**
 * The data inputs of a node and their types, as the editor offers them.
 *
 * @param node - The node a data edge enters.
 * @param agents - The agents of the workspace; an agent node without its own copy takes its inputs from them.
 * @returns The inputs by name; a loop's while input has no type a fixed value could have.
 */
export function planNotationInputs(
  node: AgentPlanNode,
  agents: readonly AgentDefinitionChoice[],
): ReadonlyMap<string, AgentParameterType | null> {
  if (node.type === "loop") return new Map(Object.entries(LOOP_INPUTS));
  const parameters =
    node.type === "git_closeout"
      ? PLAN_GIT_CLOSEOUT_PARAMETERS
      : planNodeParameters(node, agents);
  return new Map(
    parameters.map((parameter) => [parameter.name, parameter.type]),
  );
}

/** Whether a word is a DOT identifier that needs no quotes; anything else is written as text. */
export function isPlanNotationIdentifier(text: string): boolean {
  return (
    /^[\p{L}_][\p{L}\p{N}_.]*$/u.test(text) && !isPlanNotationKeyword(text)
  );
}

/** Whether a word is a DOT keyword, which never stands unquoted as a name. */
function isPlanNotationKeyword(text: string): boolean {
  return PLAN_NOTATION_KEYWORDS.includes(text.toLowerCase());
}

/**
 * Every node of a plan with the members of its frames, a loop's groups included, in stored order.
 *
 * @param plan - The plan.
 * @returns Each frame before its members.
 */
export function allPlanNotationNodes(
  plan: Pick<AgentPlanInput, "nodes">,
): readonly AgentPlanNode[] {
  return plan.nodes.flatMap((node): readonly AgentPlanNode[] => {
    if (node.type === "group")
      return [node, ...node.steps, ...(node.decisions ?? [])];
    if (node.type !== "loop") return [node];
    return [
      node,
      ...node.steps.flatMap((member): readonly AgentPlanNode[] =>
        member.type === "group"
          ? [member, ...member.steps, ...(member.decisions ?? [])]
          : [member],
      ),
      ...(node.decisions ?? []),
    ];
  });
}
