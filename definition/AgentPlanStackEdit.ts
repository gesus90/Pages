import { PLAN_STACK_ENTRY_COUNT } from "./AgentPlanStack";

import type {
  AgentPlanBinding,
  AgentPlanInput,
  AgentPlanNode,
} from "./AgentPlan";
import type { AgentPlanStack, AgentPlanStackEntry } from "./AgentPlanStack";

/** A plan after a node joined a stack, with the bindings that read the node and had to go. */
export interface PlanStackJoin<Plan extends AgentPlanInput> {
  readonly plan: Plan;
  readonly removedBindings: number;
}

/** Why a node cannot join a stack. */
export type PlanStackRefusal = "notEntry" | "full" | "missingStack";

function replaceStack<Plan extends AgentPlanInput>(
  plan: Plan,
  stack: AgentPlanStack,
): Plan {
  return {
    ...plan,
    nodes: plan.nodes.map((node) => (node.id === stack.id ? stack : node)),
  };
}

function findStack(
  plan: AgentPlanInput,
  stackId: string,
): AgentPlanStack | undefined {
  return plan.nodes.find(
    (node): node is AgentPlanStack =>
      node.type === "stack" && node.id === stackId,
  );
}

/** The entry a ticket or value node becomes; other nodes are no entries. */
function entryOf(node: AgentPlanNode): AgentPlanStackEntry | null {
  if (node.type === "task")
    return { id: node.id, type: "task", taskId: node.taskId };
  if (node.type !== "parameter") return null;
  return {
    id: node.id,
    type: "parameter",
    name: node.name,
    format: node.format,
    value: node.value,
  };
}

type BindingHolder = Extract<
  AgentPlanNode,
  { readonly bindings: Readonly<Record<string, AgentPlanBinding>> }
>;

/** Drops the bindings that read a node; counts what was dropped. */
function withoutSource<Node extends BindingHolder>(
  node: Node,
  sourceId: string,
): { readonly node: Node; readonly dropped: number } {
  const entries = Object.entries(node.bindings);
  const kept = entries.filter(
    ([, binding]) =>
      !(binding.kind === "source" && binding.nodeId === sourceId),
  );
  return {
    node: { ...node, bindings: Object.fromEntries(kept) },
    dropped: entries.length - kept.length,
  };
}

/**
 * Moves a ticket or value node of the grid into a stack, as its last entry.
 *
 * @param plan - The plan.
 * @param stackId - The stack that takes the node.
 * @param nodeId - The ticket or parameter node; it leaves the grid.
 * @returns The plan with what the move cost, or why the stack refused the node.
 *
 * @remarks
 * The node becomes data of the stack, so inputs that read it directly lose
 * that binding; they read the stack's content instead once connected to it.
 */
export function joinPlanStack<Plan extends AgentPlanInput>(
  plan: Plan,
  stackId: string,
  nodeId: string,
): PlanStackJoin<Plan> | PlanStackRefusal {
  const stack = findStack(plan, stackId);
  const node = plan.nodes.find((entry) => entry.id === nodeId);
  if (!stack) return "missingStack";
  const entry = node ? entryOf(node) : null;
  if (!entry) return "notEntry";
  if (stack.entries.length >= PLAN_STACK_ENTRY_COUNT) return "full";
  let removedBindings = 0;
  function clean<Node extends BindingHolder>(holder: Node): Node {
    const cleaned = withoutSource(holder, nodeId);
    removedBindings += cleaned.dropped;
    return cleaned.node;
  }
  const nodes = plan.nodes
    .filter((candidate) => candidate.id !== nodeId)
    .map((candidate): AgentPlanNode => {
      if (candidate.id === stackId)
        return { ...stack, entries: [...stack.entries, entry] };
      if (
        candidate.type === "agent" ||
        candidate.type === "script" ||
        candidate.type === "git_closeout"
      )
        return clean(candidate);
      if (candidate.type === "group")
        return { ...clean(candidate), steps: candidate.steps.map(clean) };
      if (candidate.type !== "loop") return candidate;
      return {
        ...clean(candidate),
        steps: candidate.steps.map((member) =>
          member.type === "group"
            ? { ...clean(member), steps: member.steps.map(clean) }
            : clean(member),
        ),
      };
    });
  return {
    plan: {
      ...plan,
      nodes,
      edges: plan.edges.filter(
        (edge) => edge.from !== nodeId && edge.to !== nodeId,
      ),
    },
    removedBindings,
  };
}

/** Appends a ticket to a stack as its last entry. */
export function addPlanStackTicket<Plan extends AgentPlanInput>(
  plan: Plan,
  stackId: string,
  entry: { readonly id: string; readonly taskId: string },
): Plan {
  const stack = findStack(plan, stackId);
  if (!stack || stack.entries.length >= PLAN_STACK_ENTRY_COUNT) return plan;
  return replaceStack(plan, {
    ...stack,
    entries: [
      ...stack.entries,
      { id: entry.id, type: "task", taskId: entry.taskId },
    ],
  });
}

/**
 * Moves an entry one place up or down; the order is the order of the handover.
 *
 * @param stack - The stack.
 * @param entryId - The entry to move.
 * @param offset - `-1` moves it one place earlier, `1` one place later.
 */
export function movePlanStackEntry(
  stack: AgentPlanStack,
  entryId: string,
  offset: -1 | 1,
): AgentPlanStack {
  const index = stack.entries.findIndex((entry) => entry.id === entryId);
  const target = index + offset;
  if (index < 0 || target < 0 || target >= stack.entries.length) return stack;
  const entries = [...stack.entries];
  const [moved] = entries.splice(index, 1);
  if (!moved) return stack;
  entries.splice(target, 0, moved);
  return { ...stack, entries };
}

/** Removes an entry; the ticket or value itself stays untouched. */
export function removePlanStackEntry(
  stack: AgentPlanStack,
  entryId: string,
): AgentPlanStack {
  return {
    ...stack,
    entries: stack.entries.filter((entry) => entry.id !== entryId),
  };
}
