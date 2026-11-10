import { planLoopStacks } from "./AgentPlanStack";

import type {
  AgentPlanBinding,
  AgentPlanDecision,
  AgentPlanEdge,
  AgentPlanInput,
  AgentPlanPosition,
  AgentPlanNode,
  AgentPlanStep,
} from "./AgentPlan";
import type { AgentPlanGroup } from "./AgentPlanGroup";
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
/** The name of the binding that feeds the boolean of a while loop. */
export const PLAN_LOOP_WHILE_BINDING = "while";
/** The most iterations a while loop runs before it fails instead of running on without end. */
export const PLAN_LOOP_WHILE_LIMIT = 999;
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

/** A runnable member of a loop: an agent or a script; the loop is never nested in itself. */
export type AgentPlanLoopMember = AgentPlanStep | AgentPlanScript;

/**
 * What a loop holds: agents, scripts and groups of agents.
 *
 * @remarks
 * A group inside a loop keeps its meaning: its agents share one session and
 * work strictly one after another. The loop alone never makes agents share a
 * session.
 */
export type AgentPlanLoopContent = AgentPlanLoopMember | AgentPlanGroup;

/**
 * How a loop decides whether another iteration runs.
 *
 * @remarks
 * `count` runs a number of iterations: a fixed number or a bound value (a
 * parameter or the count output of a stack). `while` checks a boolean before
 * every iteration, the first one included, and leaves the loop on `false`.
 * Absent in loops saved before while loops existed, which count.
 */
export type AgentPlanLoopMode = "count" | "while";

/**
 * Where a while loop takes its boolean before the second and every later iteration.
 *
 * @remarks
 * The first check always reads the bound boolean (`bindings.while`). With a
 * source member, every later check reads the newest result of that member at
 * the path, from the iteration that just completed; without one, the bound
 * boolean is read again. A value of another type is a failure, never `false`.
 */
export interface AgentPlanLoopWhile {
  /** The member whose result decides later iterations; empty to read the bound boolean again. */
  readonly sourceNodeId: string;
  /** A bounded path such as `$.continue`; see {@link parsePlanLoopPath}. */
  readonly outputPath: string;
}

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
  readonly steps: readonly AgentPlanLoopContent[];
  /**
   * Decisions of the iterations (PAGE-286); absent in loops without one.
   *
   * @remarks
   * A decision decides anew in every iteration, and what it skips is skipped
   * for that iteration only.
   */
  readonly decisions?: readonly AgentPlanDecision[];
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
  /** Absent means `count`. */
  readonly mode?: AgentPlanLoopMode;
  /** The later checks of a while loop; absent or `null` reads the bound boolean every time. */
  readonly while?: AgentPlanLoopWhile | null;
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
  // The pattern admits exactly the whole numbers 1 to 999.
  return /^[1-9][0-9]{0,2}$/u.test(text) ? Number(text) : null;
}

/**
 * Tells whether a bound value is an allowed count: 0 to 999.
 *
 * @remarks
 * A bound 0 is a valid empty case, such as an empty stack: the loop runs no
 * iteration and continues through its exit. A fixed count stays 1 to 999.
 */
export function isPlanLoopBoundRuns(runs: unknown): runs is number {
  return (
    typeof runs === "number" &&
    Number.isInteger(runs) &&
    runs >= 0 &&
    runs <= PLAN_LOOP_RUNS.maximum
  );
}

/** Reads a bound count from text: 0, or plain decimal digits up to 999. */
export function readPlanLoopBoundRunsText(text: string): number | null {
  return text === "0" ? 0 : readPlanLoopRunsText(text);
}

/** How the loop decides on another iteration; a loop saved before while loops counts. */
export function planLoopMode(
  loop: Pick<AgentPlanLoop, "mode">,
): AgentPlanLoopMode {
  return loop.mode ?? "count";
}

/** Whether the end condition counts for this loop: enabled and in `max` mode. */
export function isPlanLoopConditionActive(
  loop: Pick<AgentPlanLoop, "countMode" | "condition" | "mode">,
): boolean {
  return (
    planLoopMode(loop) === "count" &&
    loop.countMode === "max" &&
    loop.condition?.isEnabled === true
  );
}

/** The runnable members of a loop: its agents and scripts, and the agents of its groups. */
export function planLoopMembers(
  loop: Pick<AgentPlanLoop, "steps">,
): readonly AgentPlanLoopMember[] {
  return loop.steps.flatMap((member): readonly AgentPlanLoopMember[] =>
    member.type === "group" ? member.steps : [member],
  );
}

/**
 * Applies a change to every runnable member of a loop, the agents of its groups included.
 *
 * @param loop - The loop to change.
 * @param transform - The change; it keeps the type of the member it gets.
 */
export function mapPlanLoopMembers<Loop extends Pick<AgentPlanLoop, "steps">>(
  loop: Loop,
  transform: <Member extends AgentPlanLoopMember>(member: Member) => Member,
): Loop {
  return {
    ...loop,
    steps: loop.steps.map((member) =>
      member.type === "group"
        ? { ...member, steps: member.steps.map((step) => transform(step)) }
        : transform(member),
    ),
  };
}

/** The groups a loop holds. */
export function planLoopGroups(
  loop: Pick<AgentPlanLoop, "steps">,
): readonly AgentPlanGroup[] {
  return loop.steps.filter((member) => member.type === "group");
}

/** The flow edges between the members of a loop, those inside its groups included. */
export function planLoopEdges(loop: AgentPlanLoop): readonly AgentPlanEdge[] {
  const groups = planLoopGroups(loop);
  if (groups.length === 0) return loop.edges;
  return [
    ...loop.edges,
    ...groups.flatMap((group) => planGroupMemberEdges(group)),
  ];
}

/** The member edges of a group; a group without saved edges reads as the chain of its members. */
function planGroupMemberEdges(group: AgentPlanGroup): readonly AgentPlanEdge[] {
  if (group.edges) return group.edges;
  return group.steps.flatMap((step, index): AgentPlanEdge[] => {
    const previous = group.steps[index - 1];
    return previous
      ? [
          {
            from: previous.id,
            to: step.id,
            fromPort: "flow-out",
            toPort: "flow-in",
          },
        ]
      : [];
  });
}

/** Members without an internal predecessor: where the outer flow enters the loop. */
export function planLoopEntries(
  loop: AgentPlanLoop,
): readonly AgentPlanLoopMember[] {
  const edges = planLoopEdges(loop);
  return planLoopMembers(loop).filter(
    (step) => !edges.some((edge) => edge.to === step.id),
  );
}

/** Members without an internal successor: where the flow leaves the loop. */
export function planLoopExits(
  loop: AgentPlanLoop,
): readonly AgentPlanLoopMember[] {
  const edges = planLoopEdges(loop);
  return planLoopMembers(loop).filter(
    (step) => !edges.some((edge) => edge.from === step.id),
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

/** Visits every runnable member of every loop of a plan, the agents of its groups included. */
export function allPlanLoopMembers(
  plan: AgentPlanInput,
): readonly AgentPlanLoopMember[] {
  return plan.nodes.flatMap((node) =>
    node.type === "loop" ? planLoopMembers(node) : [],
  );
}

/** The loop a member, a group or an agent of a group belongs to, if any. */
export function planLoopOf(
  plan: AgentPlanInput,
  memberId: string,
): AgentPlanLoop | undefined {
  return plan.nodes.find(
    (node): node is AgentPlanLoop =>
      node.type === "loop" &&
      (node.steps.some(
        (step) =>
          step.id === memberId ||
          (step.type === "group" &&
            step.steps.some((entry) => entry.id === memberId)),
      ) ||
        planLoopDecisions(node).some((decision) => decision.id === memberId)),
  );
}

/**
 * Expands loops into their members for static graph checks.
 *
 * @remarks
 * The saved outer graph and the run snapshot keep the loop as one node. This
 * view only lets reachability, cycle and order checks see the members: an
 * edge into the loop enters its entries, an edge out of it leaves its exits.
 * The agents of a group inside a loop become plain nodes with their group's
 * edges. A stack that a loop triggers per iteration stays where it is but
 * counts as one of the loop's nodes: when no member triggers it, it is an
 * entry, so the edge into the loop reaches it.
 */
export function expandPlanLoops<Plan extends AgentPlanInput>(plan: Plan): Plan {
  const loops = plan.nodes.filter((node) => node.type === "loop");
  if (loops.length === 0) return plan;
  const nodes = plan.nodes.flatMap<AgentPlanNode>((node) =>
    node.type === "loop"
      ? [...planLoopMembers(node), ...planLoopDecisions(node)]
      : [node],
  );
  const edges: AgentPlanEdge[] = [];
  for (const edge of plan.edges) {
    const into = loops.find((loop) => loop.id === edge.to);
    const outOf = loops.find((loop) => loop.id === edge.from);
    const sources = outOf ? planLoopScopeExits(plan, outOf) : [edge.from];
    const targets = into ? planLoopScopeEntries(plan, into) : [edge.to];
    for (const from of sources)
      for (const to of targets) edges.push({ ...edge, from, to });
  }
  for (const loop of loops) edges.push(...planLoopEdges(loop));
  return { ...plan, nodes, edges };
}

/**
 * The flow edges of one iteration: between members, inside groups, and to or
 * from the stacks the loop triggers.
 */
export function planLoopScopeEdges(
  plan: Pick<AgentPlanInput, "nodes" | "edges">,
  loop: AgentPlanLoop,
): readonly AgentPlanEdge[] {
  const stacks = new Set(
    planLoopStacks(plan, loop.id).map((stack) => stack.id),
  );
  if (stacks.size === 0) return planLoopEdges(loop);
  return [
    ...planLoopEdges(loop),
    ...plan.edges.filter(
      (edge) =>
        (stacks.has(edge.from) && edge.fromPort === "flow-out") ||
        (stacks.has(edge.to) && edge.toPort === "flow-in"),
    ),
  ];
}

/** The decisions of a loop, those inside its groups included. */
export function planLoopDecisions(
  loop: Pick<AgentPlanLoop, "steps" | "decisions">,
): readonly AgentPlanDecision[] {
  return [
    ...(loop.decisions ?? []),
    ...planLoopGroups(loop).flatMap((group) => group.decisions ?? []),
  ];
}

/** The ids of the nodes of one iteration: the runnable members, the decisions and the stacks the loop triggers. */
export function planLoopScopeIds(
  plan: Pick<AgentPlanInput, "nodes" | "edges">,
  loop: AgentPlanLoop,
): readonly string[] {
  return [
    ...planLoopMembers(loop).map((member) => member.id),
    ...planLoopDecisions(loop).map((decision) => decision.id),
    ...planLoopStacks(plan, loop.id).map((stack) => stack.id),
  ];
}

/** The nodes of an iteration without a predecessor in it: where an iteration starts. */
export function planLoopScopeEntries(
  plan: Pick<AgentPlanInput, "nodes" | "edges">,
  loop: AgentPlanLoop,
): readonly string[] {
  const edges = planLoopScopeEdges(plan, loop);
  return planLoopScopeIds(plan, loop).filter(
    (id) => !edges.some((edge) => edge.to === id),
  );
}

/** The nodes of an iteration without a successor in it: where an iteration ends. */
export function planLoopScopeExits(
  plan: Pick<AgentPlanInput, "nodes" | "edges">,
  loop: AgentPlanLoop,
): readonly string[] {
  const edges = planLoopScopeEdges(plan, loop);
  return planLoopScopeIds(plan, loop).filter(
    (id) => !edges.some((edge) => edge.from === id),
  );
}
