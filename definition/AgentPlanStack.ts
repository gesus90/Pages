import type { AgentParameterValue } from "./AgentParameters";
import type {
  AgentPlanEdge,
  AgentPlanInput,
  AgentPlanParameter,
  AgentPlanPosition,
} from "./AgentPlan";
import type { AgentPlanLoop } from "./AgentPlanLoop";
import type { AgentPlanAssetEntry } from "./AgentPlanAsset";

/** The longest stack name, as long as a loop name. */
export const PLAN_STACK_NAME_LENGTH = 120;
/** The most entries a stack holds. */
export const PLAN_STACK_ENTRY_COUNT = 200;

/**
 * The two data outputs of a stack.
 *
 * @remarks
 * `content` is the entry the newest trigger handed over; `count` is the
 * number of entries the stack holds in total, never the rest or a position.
 * Both are bindings, like any other value a node reads: reading one never
 * consumes an entry. Only a trigger at `flow-in` does.
 */
export type AgentPlanStackOutput = "content" | "count";

/** The handles of the data outputs, next to `flow-out` on the right edge of the card. */
export const PLAN_STACK_PORT = {
  contentOut: "content-out",
  countOut: "count-out",
} as const;

/**
 * One entry of a stack: a ticket, a typed value or a file, in the order it is handed over.
 *
 * @remarks
 * A ticket entry hands over the ticket itself, so the receiving agent gets its
 * description, its checklist and its acceptance criteria through the existing
 * ticket parameter contract, never only its key or title. An asset entry
 * (PAGE-268) hands over its file with its own type; a stack may mix types. An
 * entry is data: it grants no right the executor does not already have.
 */
export type AgentPlanStackEntry =
  | {
      readonly id: string;
      readonly type: "task";
      readonly taskId: string;
    }
  | {
      readonly id: string;
      readonly type: "parameter";
      readonly name: string;
      readonly format: AgentPlanParameter["format"];
      readonly value: AgentParameterValue;
    }
  | AgentPlanAssetEntry;

/**
 * A stack: an ordered list of entries; every trigger hands over the next one.
 *
 * @remarks
 * The stack is a flow node the scheduler evaluates itself, without a model,
 * like a decision. Each trigger at `flow-in` hands the next entry to
 * `flow-out`; once every entry was handed over, a further trigger hands over
 * nothing and starts nothing behind `flow-out`. A new run of the plan starts
 * again with the first entry; a resumed run keeps what it handed over.
 */
export interface AgentPlanStack extends AgentPlanPosition {
  readonly id: string;
  readonly type: "stack";
  readonly name: string;
  readonly entries: readonly AgentPlanStackEntry[];
}

/**
 * Where a stack is triggered: in the outer graph, or once per iteration of a loop.
 *
 * @remarks
 * A stack stays an outer node of the plan; it is never moved into a loop. When
 * its flow edges join it to the members of a loop, it is a step of that loop's
 * iterations: each iteration triggers it once, unless a member before it
 * triggers it explicitly.
 */
export type AgentPlanStackScope =
  | { readonly kind: "outer" }
  | { readonly kind: "loop"; readonly loopId: string }
  | { readonly kind: "mixed" };

/** What one trigger of a stack handed over. */
export interface AgentPlanStackHandover {
  /** The entry handed over; `null` when the stack was empty or used up. */
  readonly entryId: string | null;
  /** The position of the entry, counting from 1; 0 for a trigger that found nothing. */
  readonly position: number;
  /** The number of entries of the stack. */
  readonly total: number;
}

/** One handover of a stack entry during a run. */
export interface AgentPlanStackDelivery {
  readonly entryId: string;
  /** Counts from 1. */
  readonly position: number;
  /** The loop whose iteration triggered the stack, or `null` in the outer graph. */
  readonly loopId: string | null;
  readonly iteration: number | null;
  readonly at: string;
}

/**
 * The state of one stack in a run.
 *
 * @remarks
 * Persisted with the run. The handovers decide the next entry, so a resumed
 * run never hands an entry over twice and never skips one. A new run starts
 * without this record and therefore with the first entry.
 */
export interface AgentPlanStackRun {
  readonly id: string;
  readonly name: string;
  readonly total: number;
  readonly deliveries: readonly AgentPlanStackDelivery[];
  /** Triggers that found the stack empty or used up; they handed over nothing. */
  readonly emptyTriggers: number;
  /** What the newest trigger did: handed an entry over, found nothing, or no trigger yet. */
  readonly last: "entry" | "empty" | null;
}

/** Creates an empty stack. */
export function emptyPlanStack(
  id: string,
  name: string,
  position: AgentPlanPosition,
): AgentPlanStack {
  return { id, type: "stack", name, ...position, entries: [] };
}

/** The stacks of a plan. */
export function planStacks(
  plan: Pick<AgentPlanInput, "nodes">,
): readonly AgentPlanStack[] {
  return plan.nodes.filter((node) => node.type === "stack");
}

/** The ids of every member of a loop, including the agents of the groups it holds. */
function loopMemberIds(loop: AgentPlanLoop): ReadonlySet<string> {
  return new Set(
    loop.steps.flatMap((member) =>
      member.type === "group"
        ? [member.id, ...member.steps.map((step) => step.id)]
        : [member.id],
    ),
  );
}

/** The flow edges of the plan that touch the stack. */
export function planStackFlowEdges(
  plan: Pick<AgentPlanInput, "edges">,
  stackId: string,
): readonly AgentPlanEdge[] {
  return plan.edges.filter(
    (edge) =>
      (edge.from === stackId && edge.fromPort === "flow-out") ||
      (edge.to === stackId && edge.toPort === "flow-in"),
  );
}

/**
 * Where the stack is triggered, decided by the nodes its flow edges join.
 *
 * @returns `loop` when every flow edge joins it to members of one loop,
 * `outer` when none does, `mixed` for a stack that joins a loop and anything
 * else; the plan check refuses a mixed stack.
 */
export function planStackScope(
  plan: Pick<AgentPlanInput, "nodes" | "edges">,
  stackId: string,
): AgentPlanStackScope {
  const loops = plan.nodes.filter((node) => node.type === "loop");
  const others = planStackFlowEdges(plan, stackId).map((edge) =>
    edge.from === stackId ? edge.to : edge.from,
  );
  const owners = new Set(
    others.map(
      (id) => loops.find((loop) => loopMemberIds(loop).has(id))?.id ?? "",
    ),
  );
  if (owners.size === 0 || (owners.size === 1 && owners.has("")))
    return { kind: "outer" };
  const [loopId] = [...owners];
  return owners.size === 1 && loopId
    ? { kind: "loop", loopId }
    : { kind: "mixed" };
}

/**
 * Whether anything can trigger the stack: it has a flow edge.
 *
 * @remarks
 * A stack without a flow edge is only read: its count, or no content at all.
 * Nothing triggers it, so it never hands over an entry.
 */
export function isPlanStackTriggered(
  plan: Pick<AgentPlanInput, "edges">,
  stackId: string,
): boolean {
  return planStackFlowEdges(plan, stackId).length > 0;
}

/**
 * Whether a node is a step of the outer graph of a run.
 *
 * @param plan - The frozen plan.
 * @param node - A flow node of it.
 * @returns `false` only for a stack that a loop triggers, which is a step of
 * that loop's iterations, and for a stack that nothing triggers, which is only read.
 */
export function isPlanOuterRunStep(
  plan: Pick<AgentPlanInput, "nodes" | "edges">,
  node: { readonly id: string; readonly type: string },
): boolean {
  if (node.type !== "stack") return true;
  return (
    isPlanStackTriggered(plan, node.id) &&
    planStackScope(plan, node.id).kind !== "loop"
  );
}

/** The stacks a loop triggers once per iteration. */
export function planLoopStacks(
  plan: Pick<AgentPlanInput, "nodes" | "edges">,
  loopId: string,
): readonly AgentPlanStack[] {
  return planStacks(plan).filter((stack) => {
    const scope = planStackScope(plan, stack.id);
    return scope.kind === "loop" && scope.loopId === loopId;
  });
}

/** Whether the stack is a step of a loop's iterations rather than of the outer graph. */
export function isPlanLoopStack(
  plan: Pick<AgentPlanInput, "nodes" | "edges">,
  stackId: string,
): boolean {
  return planStackScope(plan, stackId).kind === "loop";
}

/**
 * What the next trigger hands over, from the deliveries so far.
 *
 * @remarks
 * The position follows the record, never a counter of its own, so a stack
 * whose last trigger found nothing stays used up: it never starts over.
 */
export function nextPlanStackHandover(
  stack: Pick<AgentPlanStack, "entries">,
  record: Pick<AgentPlanStackRun, "deliveries"> | undefined,
): AgentPlanStackHandover {
  const position = (record?.deliveries.length ?? 0) + 1;
  const entry = stack.entries[position - 1];
  return entry
    ? { entryId: entry.id, position, total: stack.entries.length }
    : { entryId: null, position: 0, total: stack.entries.length };
}

/** The record of a stack before its first trigger in a run. */
export function initialPlanStackRun(
  stack: Pick<AgentPlanStack, "id" | "name" | "entries">,
): AgentPlanStackRun {
  return {
    id: stack.id,
    name: stack.name,
    total: stack.entries.length,
    deliveries: [],
    emptyTriggers: 0,
    last: null,
  };
}

/**
 * Records one trigger of a stack.
 *
 * @param record - The record so far, absent before the first trigger.
 * @param stack - The frozen stack.
 * @param origin - The loop iteration that triggered it, or `null` values in the outer graph.
 * @returns The new record and what the trigger handed over.
 */
export function triggerPlanStack(
  record: AgentPlanStackRun | undefined,
  stack: AgentPlanStack,
  origin: {
    readonly loopId: string | null;
    readonly iteration: number | null;
    readonly at: string;
  },
): {
  readonly record: AgentPlanStackRun;
  readonly handover: AgentPlanStackHandover;
} {
  const current = record ?? initialPlanStackRun(stack);
  const handover = nextPlanStackHandover(stack, current);
  if (handover.entryId === null)
    return {
      handover,
      record: {
        ...current,
        emptyTriggers: current.emptyTriggers + 1,
        last: "empty",
      },
    };
  return {
    handover,
    record: {
      ...current,
      last: "entry",
      deliveries: [
        ...current.deliveries,
        {
          entryId: handover.entryId,
          position: handover.position,
          loopId: origin.loopId,
          iteration: origin.iteration,
          at: origin.at,
        },
      ],
    },
  };
}

/**
 * The entry a reader of the content output receives now.
 *
 * @returns The entry the newest trigger handed over, or `null` before the
 * first trigger and after a trigger that found the stack used up: an earlier
 * entry is never handed over again.
 */
export function currentPlanStackEntry(
  stack: Pick<AgentPlanStack, "entries">,
  record: Pick<AgentPlanStackRun, "deliveries" | "last"> | undefined,
): AgentPlanStackEntry | null {
  if (record?.last !== "entry") return null;
  const entryId = record.deliveries.at(-1)?.entryId;
  return stack.entries.find((entry) => entry.id === entryId) ?? null;
}

/** The state a stack shows: still entries left, used up, or empty from the start. */
export function planStackState(
  stack: Pick<AgentPlanStack, "entries">,
  record: Pick<AgentPlanStackRun, "deliveries"> | undefined,
): "ready" | "used" | "empty" {
  if (stack.entries.length === 0) return "empty";
  return (record?.deliveries.length ?? 0) >= stack.entries.length
    ? "used"
    : "ready";
}
