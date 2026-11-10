import { planGroupEdges } from "./AgentPlanGroup";
import { planLoopDecisions } from "./AgentPlanLoop";

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

/**
 * Removing a node also removes its flow and parameter references.
 *
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
  const removed = new Set([id, ...containedIds(container)]);
  function withoutReferences<
    Node extends
      | AgentPlanStep
      | AgentPlanScript
      | AgentPlanGitCloseout
      | AgentPlanGroup
      | AgentPlanLoop,
  >(node: Node): Node {
    const bindings = Object.fromEntries(
      Object.entries(node.bindings).filter(
        ([, binding]) => !isRemovedBinding(binding, removed),
      ),
    );
    return { ...node, bindings };
  }
  const withoutDecisions = (
    decisions: readonly AgentPlanDecision[] | undefined,
  ): { readonly decisions?: readonly AgentPlanDecision[] } =>
    withoutRemovedDecisions(decisions, removed);
  const withoutDecisionInput = (
    decision: AgentPlanDecision,
  ): AgentPlanDecision => withoutRemovedInput(decision, removed);
  function withoutMember(
    node: AgentPlanGroup | AgentPlanLoop,
  ): AgentPlanGroup | AgentPlanLoop {
    if (node.type === "loop") {
      const steps = node.steps
        .filter((step) => step.id !== id)
        .map((step) =>
          step.type === "group"
            ? withoutGroupMember(withoutReferences(step))
            : withoutReferences(step),
        );
      return {
        ...withoutReferences(node),
        ...withoutDecisions(node.decisions),
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
    return withoutGroupMember(withoutReferences(node));
  }
  function withoutGroupMember(node: AgentPlanGroup): AgentPlanGroup {
    const steps = node.steps
      .filter((step) => step.id !== id)
      .map(withoutReferences);
    const hasMember =
      steps.length !== node.steps.length ||
      (node.decisions ?? []).some((decision) => decision.id === id);
    return {
      ...node,
      ...withoutDecisions(node.decisions),
      steps,
      ...(hasMember
        ? {
            edges: planGroupEdges(node).filter(
              (edge) => edge.from !== id && edge.to !== id,
            ),
          }
        : {}),
    };
  }
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
          return withoutReferences(node);
        if (node.type === "decision") return withoutDecisionInput(node);
        if (node.type !== "group" && node.type !== "loop") return node;
        return withoutMember(node);
      }),
    edges: draft.edges.filter(
      (edge) => !removed.has(edge.from) && !removed.has(edge.to),
    ),
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
  for (const node of plan.nodes) {
    if (node.id === id) return node;
    if (node.type !== "loop") continue;
    const member = node.steps.find((step) => step.id === id);
    if (member) return member;
  }
  return undefined;
}

/** The ids of what a container holds: the members of a group or loop, the agents of a loop's groups. */
function containedIds(node: AgentPlanNode | undefined): readonly string[] {
  if (node?.type === "group")
    return [...node.steps, ...(node.decisions ?? [])].map((step) => step.id);
  if (node?.type !== "loop") return [];
  return [
    ...node.steps.flatMap((step) =>
      step.type === "group"
        ? [step.id, ...step.steps.map((entry) => entry.id)]
        : [step.id],
    ),
    ...planLoopDecisions(node).map((decision) => decision.id),
  ];
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
