import type {
  AgentPlanBinding,
  AgentPlanEdge,
  AgentPlanInput,
  AgentPlanPosition,
  AgentPlanNode,
  AgentPlanStep,
} from "./AgentPlan";
import type { AgentPlanScript } from "./AgentPlanScript";

/** The allowed number of iterations of a loop: whole numbers, both ends included. */
export const PLAN_LOOP_RUNS = { minimum: 1, maximum: 999, initial: 1 } as const;
/** The longest loop name, as long as a group name. */
export const PLAN_LOOP_NAME_LENGTH = 120;
/** The longest JSON path of an end condition. */
export const PLAN_LOOP_PATH_LENGTH = 200;
/** The most segments a JSON path may have. */
export const PLAN_LOOP_PATH_SEGMENTS = 8;
/** The longest text an end condition compares with. */
export const PLAN_LOOP_VALUE_LENGTH = 1_000;
/** The name of the binding that feeds the number of iterations from a parameter. */
export const PLAN_LOOP_RUNS_BINDING = "runs";
/** The most members a loop holds. */
export const PLAN_LOOP_MEMBER_COUNT = 50;

/**
 * How the number of iterations counts.
 *
 * @remarks
 * `max` runs at most that many iterations and may end earlier on its end
 * condition; `expected` runs exactly that many and ignores the condition.
 */
export type AgentPlanLoopCountMode = "max" | "expected";

/**
 * What happens to the ACP session of a member agent between two iterations.
 *
 * @remarks
 * `reuse` keeps one process and ACP session per agent node for the whole run
 * of the loop and sends each further iteration as a new turn. `fresh` opens a
 * new session for every iteration and ends it with the node; only the bound
 * inputs carry over. Nothing else is offered: no silent third behavior.
 */
export type AgentPlanLoopSessionPolicy = "reuse" | "fresh";

/** Whether the number of iterations is the saved value or a bound parameter node. */
export type AgentPlanLoopRunsSource = "value" | "parameter";

/** A member of a loop: an agent or a script; the loop is never nested in itself. */
export type AgentPlanLoopMember = AgentPlanStep | AgentPlanScript;

/** A typed expected value; the comparison never converts between types. */
export type AgentPlanLoopValue =
  | { readonly type: "boolean"; readonly value: boolean }
  | { readonly type: "number"; readonly value: number }
  | { readonly type: "string"; readonly value: string }
  | { readonly type: "null" };

/**
 * The early end condition of a loop in `max` mode.
 *
 * @remarks
 * It stays saved while the loop counts `expected` or the condition is off,
 * but only an enabled condition of a `max` loop is ever evaluated.
 */
export interface AgentPlanLoopCondition {
  readonly isEnabled: boolean;
  /** The agent or script member whose result carries the JSON. */
  readonly sourceNodeId: string;
  /** A bounded path such as `$.end` or `$.review.end`; see {@link parsePlanLoopPath}. */
  readonly outputPath: string;
  readonly operator: "equals";
  readonly expected: AgentPlanLoopValue;
}

/**
 * A loop: a container whose agent and script members repeat as one subgraph.
 *
 * @remarks
 * Outwardly the loop is one flow node with an entry and an exit; the outer
 * graph stays acyclic and the iterations repeat the inner one. Members carry
 * positions that count from the top left corner of the loop's member area,
 * like those of a group. Members without an internal predecessor are where
 * the outer flow enters, members without a successor where it leaves.
 */
export interface AgentPlanLoop extends AgentPlanPosition {
  readonly id: string;
  readonly type: "loop";
  readonly name: string;
  readonly steps: readonly AgentPlanLoopMember[];
  /** Flow edges between members, which alone decide the order within an iteration. */
  readonly edges: readonly AgentPlanEdge[];
  /** The saved number of iterations; used only while `runsSource` is `value`. */
  readonly runs: number;
  readonly runsSource: AgentPlanLoopRunsSource;
  /** `runs` names the parameter node of a `parameter` source; the number is never guessed. */
  readonly bindings: Readonly<Record<string, AgentPlanBinding>>;
  readonly countMode: AgentPlanLoopCountMode;
  readonly sessionPolicy: AgentPlanLoopSessionPolicy;
  readonly condition: AgentPlanLoopCondition | null;
}

/** The segments of a JSON path: property names and array positions. */
export type PlanLoopPathSegment = string | number;

const PATH_SEGMENT = /^(?:\.([A-Za-z_][A-Za-z0-9_]{0,63})|\[(\d{1,3})\])/u;

/**
 * Reads a JSON path of an end condition.
 *
 * @param path - `$` followed by `.name` and `[index]` segments, such as `$.review.end` or `$.items[0].done`.
 * @returns The segments, or `null` for an empty, too long or otherwise
 * unsupported path. No wildcard, filter, recursion or script is part of it.
 */
export function parsePlanLoopPath(
  path: string,
): readonly PlanLoopPathSegment[] | null {
  if (path.length > PLAN_LOOP_PATH_LENGTH || !path.startsWith("$")) return null;
  const segments: PlanLoopPathSegment[] = [];
  let rest = path.slice(1);
  while (rest.length > 0) {
    const match = PATH_SEGMENT.exec(rest);
    if (!match) return null;
    segments.push(match[1] ?? Number(match[2]));
    rest = rest.slice(match[0].length);
  }
  return segments.length > 0 && segments.length <= PLAN_LOOP_PATH_SEGMENTS
    ? segments
    : null;
}

/** Tells whether a number is an allowed count of iterations. */
export function isPlanLoopRuns(runs: unknown): runs is number {
  return (
    typeof runs === "number" &&
    Number.isInteger(runs) &&
    runs >= PLAN_LOOP_RUNS.minimum &&
    runs <= PLAN_LOOP_RUNS.maximum
  );
}

/**
 * Reads a count from the text of a parameter, strictly as decimal digits.
 *
 * @returns The number, or `null` for anything else: signs, fractions,
 * exponents, spaces, leading zeros and expressions are refused, never rounded.
 */
export function readPlanLoopRunsText(text: string): number | null {
  if (!/^[1-9][0-9]{0,2}$/u.test(text)) return null;
  const runs = Number(text);
  return isPlanLoopRuns(runs) ? runs : null;
}

/** Whether the end condition counts for this loop: enabled and in `max` mode. */
export function isPlanLoopConditionActive(
  loop: Pick<AgentPlanLoop, "countMode" | "condition">,
): boolean {
  return loop.countMode === "max" && loop.condition?.isEnabled === true;
}

/** The flow edges between the members of a loop. */
export function planLoopEdges(loop: AgentPlanLoop): readonly AgentPlanEdge[] {
  return loop.edges;
}

/** Members without an internal predecessor: where the outer flow enters the loop. */
export function planLoopEntries(
  loop: AgentPlanLoop,
): readonly AgentPlanLoopMember[] {
  return loop.steps.filter(
    (step) => !loop.edges.some((edge) => edge.to === step.id),
  );
}

/** Members without an internal successor: where the flow leaves the loop. */
export function planLoopExits(
  loop: AgentPlanLoop,
): readonly AgentPlanLoopMember[] {
  return loop.steps.filter(
    (step) => !loop.edges.some((edge) => edge.from === step.id),
  );
}

/** Creates an empty loop that runs once, counts `max` and keeps its sessions. */
export function emptyPlanLoop(
  id: string,
  name: string,
  position: AgentPlanPosition,
): AgentPlanLoop {
  return {
    id,
    type: "loop",
    name,
    ...position,
    steps: [],
    edges: [],
    runs: PLAN_LOOP_RUNS.initial,
    runsSource: "value",
    bindings: {},
    countMode: "max",
    sessionPolicy: "reuse",
    condition: null,
  };
}

/** Visits every member of every loop of a plan. */
export function allPlanLoopMembers(
  plan: AgentPlanInput,
): readonly AgentPlanLoopMember[] {
  return plan.nodes.flatMap((node) => (node.type === "loop" ? node.steps : []));
}

/** The loop a member belongs to, if any. */
export function planLoopOf(
  plan: AgentPlanInput,
  memberId: string,
): AgentPlanLoop | undefined {
  return plan.nodes.find(
    (node): node is AgentPlanLoop =>
      node.type === "loop" && node.steps.some((step) => step.id === memberId),
  );
}

/**
 * Expands loops into their members for static graph checks.
 *
 * @remarks
 * The saved outer graph and the run snapshot keep the loop as one node. This
 * view only lets reachability, cycle and order checks see the members: an
 * edge into the loop enters its entries, an edge out of it leaves its exits.
 */
export function expandPlanLoops<Plan extends AgentPlanInput>(plan: Plan): Plan {
  const loops = plan.nodes.filter((node) => node.type === "loop");
  if (loops.length === 0) return plan;
  const nodes = plan.nodes.flatMap<AgentPlanNode>((node) =>
    node.type === "loop" ? node.steps : [node],
  );
  const edges: AgentPlanEdge[] = [];
  for (const edge of plan.edges) {
    const into = loops.find((loop) => loop.id === edge.to);
    const outOf = loops.find((loop) => loop.id === edge.from);
    const sources = outOf
      ? planLoopExits(outOf).map((step) => step.id)
      : [edge.from];
    const targets = into
      ? planLoopEntries(into).map((step) => step.id)
      : [edge.to];
    for (const from of sources)
      for (const to of targets) edges.push({ ...edge, from, to });
  }
  for (const loop of loops) edges.push(...planLoopEdges(loop));
  return { ...plan, nodes, edges };
}
