import { planEdgeKind } from "./AgentPlanBranching";
import { expandPlanGroups } from "./AgentPlanGroup";
import { withPortlessPlanGroups } from "./AgentPlanGroupUpgrade";
import { hasPlanPath } from "./AgentPlanPath";
import { planBindingNodes } from "./AgentPlanStackGraph";
import { expandPlanLoops } from "./AgentPlanLoop";
import { isPlanEntryCallable, isPlanEntryNode } from "./AgentPlanJump";

import type { AgentPlanInput, AgentPlanNode } from "./AgentPlan";
import type { AgentPlanIssue } from "./AgentPlanGraph";

/**
 * The nodes a run begins at.
 * @param flat - The plan with its groups expanded.
 * @param entryNodeId - The entry a call names; absent for a start by a person.
 * @remarks
 * A person starts the plan at its start nodes only. A call begins at exactly
 * the entry it names, and only while that entry is released for calls; every
 * other entry stays inactive for this run.
 */
function entryNodes(
  flat: AgentPlanInput,
  entryNodeId: string | undefined,
): readonly AgentPlanNode[] {
  if (entryNodeId === undefined)
    return flat.nodes.filter((node) => node.type === "start");
  return flat.nodes.filter(
    (node) =>
      node.id === entryNodeId &&
      isPlanEntryNode(node) &&
      isPlanEntryCallable(node),
  );
}

/** Nodes on any complete execution path; value and event edges never establish a start path. */
function executionIds(
  plan: AgentPlanInput,
  entryNodeId: string | undefined,
): ReadonlySet<string> {
  const flat = expandPlanGroups(withPortlessPlanGroups(plan));
  const ids = new Set(flat.nodes.map((node) => node.id));
  const edges = flat.edges.filter((edge) => {
    const kind = planEdgeKind(edge);
    return (
      kind !== null &&
      kind !== "event" &&
      ids.has(edge.from) &&
      ids.has(edge.to)
    );
  });
  const starts = entryNodes(flat, entryNodeId);
  const ends = flat.nodes.filter((node) => node.type === "end");
  if (
    !starts.some((start) =>
      ends.some((end) => hasPlanPath(edges, start.id, end.id)),
    )
  )
    return new Set();
  // Events cannot establish the start path. Once it exists, a repair branch
  // returning to it is part of the same execution and keeps its event sender.
  const returning = flat.edges
    .filter(
      (edge) =>
        planEdgeKind(edge) === "event" &&
        ids.has(edge.from) &&
        ids.has(edge.to),
    )
    .map((edge) => ({ ...edge, fromPort: "flow-out", toPort: "flow-in" }));
  const execution = [...edges, ...returning];
  return new Set(
    flat.nodes
      .filter(
        (node) =>
          starts.some(
            (start) =>
              start.id === node.id || hasPlanPath(execution, start.id, node.id),
          ) &&
          ends.some(
            (end) =>
              end.id === node.id || hasPlanPath(execution, node.id, end.id),
          ),
      )
      .map((node) => node.id),
  );
}

/**
 * The only graph condition for starting a plan, shared by all entry points.
 * @param plan - The saved plan.
 * @param entryNodeId - The entry a call names; absent for a start by a person.
 * @remarks
 * A start by a person needs a start with a path to an end. A plan that only
 * receives calls has no such path and says so with its own finding instead of
 * a generic one. A call needs its entry to exist, to be released for calls and
 * to reach an end.
 */
export function planStartIssues(
  plan: AgentPlanInput,
  entryNodeId?: string,
): readonly AgentPlanIssue[] {
  if (entryNodeId !== undefined) {
    const entry = plan.nodes.find((node) => node.id === entryNodeId);
    if (!isPlanEntryNode(entry) || !isPlanEntryCallable(entry))
      return [{ nodeId: entryNodeId, port: null, reason: "jumpEntry" }];
    return executionIds(plan, entryNodeId).has(entryNodeId)
      ? []
      : [{ nodeId: entryNodeId, port: null, reason: "startEndDisconnected" }];
  }
  const active = executionIds(plan, undefined);
  if (
    plan.nodes.some((node) => node.type === "start" && active.has(node.id))
  )
    return [];
  const receivesCalls = plan.nodes.some(
    (node) => node.type === "jump" && node.direction === "in",
  );
  return [
    {
      nodeId: null,
      port: null,
      reason: receivesCalls ? "manualStart" : "startEndDisconnected",
    },
  ];
}

function activeNode(
  node: AgentPlanNode,
  ids: ReadonlySet<string>,
): AgentPlanNode | null {
  if (node.type !== "group") return ids.has(node.id) ? node : null;
  const steps = node.steps.filter((step) => ids.has(step.id));
  const decisions = node.decisions?.filter((decision) => ids.has(decision.id));
  const loops = node.loops?.filter((loop) => ids.has(loop.id));
  if (steps.length === 0 && !decisions?.length && !loops?.length) return null;
  return {
    ...node,
    steps,
    loops,
    decisions,
    edges: node.edges?.filter((edge) => ids.has(edge.from) && ids.has(edge.to)),
  };
}

/**
 * Keeps complete entry→End paths and their data sources. Detached nodes and
 * dead flow branches never enter preparation, authorization or scheduling.
 * @param plan - The saved plan.
 * @param entryNodeId - The entry a call names; absent for a start by a person.
 * @remarks
 * Exactly one entry takes part in a run: the start nodes for a person, the
 * named entry for a call. Every other entry is dropped, so nothing behind it
 * starts by itself.
 */
export function executablePlan<Plan extends AgentPlanInput>(
  plan: Plan,
  entryNodeId?: string,
): Plan {
  plan = withPortlessPlanGroups(plan);
  const ids = executionIds(plan, entryNodeId);
  const flow = plan.nodes.flatMap((node) => {
    const active = activeNode(node, ids);
    return active ? [active] : [];
  });
  const sources = new Set<string>();
  const consumers = planBindingNodes({ ...plan, nodes: flow });
  for (const node of consumers) {
    for (const binding of Object.values(node.bindings)) {
      if (binding.kind === "source") sources.add(binding.nodeId);
      if (binding.kind === "stack") sources.add(binding.stackId);
    }
  }
  for (const node of flow)
    if (node.type === "end")
      for (const binding of Object.values(node.bindings ?? {})) {
        if (binding.kind === "source") sources.add(binding.nodeId);
      }
  const decisions = expandPlanLoops(
    expandPlanGroups({ ...plan, nodes: flow }),
  ).nodes;
  for (const node of decisions) {
    if (node.type !== "decision") continue;
    if (node.input?.kind === "source") sources.add(node.input.nodeId);
    if (node.input?.kind === "stack") sources.add(node.input.stackId);
  }
  const nodes = [
    ...flow,
    ...plan.nodes.filter(
      (node) =>
        sources.has(node.id) &&
        !flow.some((entry) => entry.id === node.id) &&
        ["task", "parameter", "variable", "asset", "stack"].includes(node.type),
    ),
  ];
  const retained = new Set([
    ...nodes.map((node) => node.id),
    ...expandPlanGroups({ ...plan, nodes }).nodes.map((node) => node.id),
    ...expandPlanLoops(expandPlanGroups({ ...plan, nodes })).nodes.map(
      (node) => node.id,
    ),
    ...consumers.map((node) => node.id),
  ]);
  return {
    ...plan,
    nodes,
    edges: plan.edges.filter(
      (edge) => retained.has(edge.from) && retained.has(edge.to),
    ),
  };
}
