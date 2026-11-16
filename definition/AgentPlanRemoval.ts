import { planContainedNodes } from "./AgentPlanGroupLoop";
import { planGroupEdges } from "./AgentPlanGroup";

import type {
  AgentPlanBinding,
  AgentPlanDecision,
  AgentPlanInput,
  AgentPlanNode,
  AgentPlanStep,
} from "./AgentPlan";
import type { AgentPlanGitCloseout } from "./AgentPlanGitCloseout";
import type { AgentPlanGroup } from "./AgentPlanGroup";
import type { AgentPlanLoop } from "./AgentPlanLoop";
import type { AgentPlanScript } from "./AgentPlanScript";

/** What a removal takes away: the node the user removed and what it contained. */
interface Removal {
  readonly id: string;
  readonly removed: ReadonlySet<string>;
}

/**
 * Removing a node also removes its flow and parameter references.
 * @remarks
 * The node may be a member of a group; the group then loses the member and
 * its internal edges. Removing a group removes its members with it, together
 * with every reference to them; keeping the members is
 * {@link ungroupPlanGroup}'s work, never a silent fallback.
 */
export function removePlanNode<Plan extends AgentPlanInput>(
  draft: Plan,
  id: string,
): Plan {
  const container = findContainer(draft, id);
  const removal: Removal = {
    id,
    removed: new Set([id, ...containedIds(container)]),
  };
  const { removed } = removal;
  return {
    ...draft,
    nodes: draft.nodes
      .filter((node) => node.id !== id)
      .map((node) => {
        if (
          node.type === "agent" ||
          node.type === "script" ||
          node.type === "git_closeout"
        )
          return withoutReferences(node, removed);
        if (node.type === "decision") return withoutRemovedInput(node, removed);
        if (node.type !== "group" && node.type !== "loop") return node;
        return withoutMember(node, removal);
      }),
    edges: draft.edges.filter(
      (edge) => !removed.has(edge.from) && !removed.has(edge.to),
    ),
  };
}

/** Drops the bindings that read a removed node. */
function withoutReferences<
  Node extends
    | AgentPlanStep
    | AgentPlanScript
    | AgentPlanGitCloseout
    | AgentPlanGroup
    | AgentPlanLoop,
>(node: Node, removed: ReadonlySet<string>): Node {
  const bindings = Object.fromEntries(
    Object.entries(node.bindings).filter(
      ([, binding]) => !isRemovedBinding(binding, removed),
    ),
  );
  return { ...node, bindings };
}

/** Removes the member from a group or loop that contains it, at any depth. */
function withoutMember(
  node: AgentPlanGroup | AgentPlanLoop,
  removal: Removal,
): AgentPlanGroup | AgentPlanLoop {
  if (node.type === "loop") return withoutLoopMember(node, removal);
  return withoutGroupMember(withoutReferences(node, removal.removed), removal);
}

function withoutLoopMember(
  node: AgentPlanLoop,
  removal: Removal,
): AgentPlanLoop {
  const { id, removed } = removal;
  const steps = node.steps
    .filter((step) => step.id !== id)
    .map((step) =>
      step.type === "group"
        ? withoutGroupMember(withoutReferences(step, removed), removal)
        : withoutReferences(step, removed),
    );
  return {
    ...withoutReferences(node, removed),
    ...withoutRemovedDecisions(node.decisions, removed),
    steps,
    edges: node.edges.filter(
      (edge) => !removed.has(edge.from) && !removed.has(edge.to),
    ),
    condition:
      node.condition && removed.has(node.condition.sourceNodeId)
        ? { ...node.condition, sourceNodeId: "" }
        : node.condition,
    ...(node.while && removed.has(node.while.sourceNodeId)
      ? { while: { ...node.while, sourceNodeId: "" } }
      : {}),
  };
}

function withoutGroupMember(
  node: AgentPlanGroup,
  removal: Removal,
): AgentPlanGroup {
  const { id, removed } = removal;
  const steps = node.steps
    .filter((step) => step.id !== id)
    .map((step) => withoutReferences(step, removed));
  const hasMember =
    steps.length !== node.steps.length ||
    (node.decisions ?? []).some((decision) => decision.id === id) ||
    (node.loops ?? []).some((loop) => removed.has(loop.id));
  return {
    ...node,
    ...withoutRemovedDecisions(node.decisions, removed),
    steps,
    ...(node.loops
      ? {
          loops: node.loops
            .filter((loop) => !removed.has(loop.id))
            .map((loop) => {
              const changed = withoutMember(loop, removal);
              return changed.type === "loop" ? changed : loop;
            }),
        }
      : {}),
    ...(hasMember
      ? {
          edges: planGroupEdges(node).filter(
            (edge) => edge.from !== id && edge.to !== id,
          ),
        }
      : {}),
  };
}

/** A decision loses an input that read a removed node. */
function withoutRemovedInput(
  decision: AgentPlanDecision,
  removed: ReadonlySet<string>,
): AgentPlanDecision {
  if (!decision.input || !isRemovedBinding(decision.input, removed))
    return decision;
  return { ...decision, input: undefined };
}

/** The decisions of a container without the removed ones and without inputs from removed nodes. */
function withoutRemovedDecisions(
  decisions: readonly AgentPlanDecision[] | undefined,
  removed: ReadonlySet<string>,
): { readonly decisions?: readonly AgentPlanDecision[] } {
  if (!decisions) return {};
  return {
    decisions: decisions
      .filter((decision) => !removed.has(decision.id))
      .map((decision) => withoutRemovedInput(decision, removed)),
  };
}

/** The node, group or loop with the id, at the top level or inside a loop. */
function findContainer(
  plan: AgentPlanInput,
  id: string,
): AgentPlanNode | undefined {
  return planContainedNodes(plan).find((node) => node.id === id);
}

/** The ids of what a container holds: the members of a group or loop, the agents of a loop's groups. */
function containedIds(node: AgentPlanNode | undefined): readonly string[] {
  if (!node) return [];
  return planContainedNodes({ nodes: [node] })
    .filter((entry) => entry.id !== node.id)
    .map((entry) => entry.id);
}

/** Whether a binding reads a node that is removed. */
function isRemovedBinding(
  binding: AgentPlanBinding,
  removed: ReadonlySet<string>,
): boolean {
  if (binding.kind === "source") return removed.has(binding.nodeId);
  if (binding.kind === "stack") return removed.has(binding.stackId);
  if (binding.kind === "result" || binding.kind === "previous")
    return removed.has(binding.stepId);
  return false;
}
