import { planNodeLabel } from "./plan-layout";

import type { AgentPlanInput, AgentPlanSources } from "@/definition/AgentPlan";

/** A flow edge between steps; it orders execution. */
interface PlanFlowLink {
  readonly kind: "flow";
  readonly from: string;
  readonly to: string;
}

/** A source or result bound to one named parameter of an agent node. */
interface PlanDataLink {
  readonly kind: "data";
  readonly from: string;
  readonly to: string;
  readonly parameter: string;
}

/** One connection the grid draws, selects and removes on its own. */
export type PlanLink = PlanFlowLink | PlanDataLink;

/** Lists flow edges and parameter bindings whose two nodes both exist. */
export function planLinks(plan: AgentPlanInput): readonly PlanLink[] {
  const ids = new Set(plan.nodes.map((node) => node.id));
  const links: PlanLink[] = plan.edges
    .filter((edge) => ids.has(edge.from) && ids.has(edge.to))
    .map((edge) => ({ kind: "flow", from: edge.from, to: edge.to }));
  for (const target of plan.nodes) {
    if (target.type !== "agent" && target.type !== "group") continue;
    for (const [parameter, binding] of Object.entries(target.bindings)) {
      if (binding.kind === "literal") continue;
      const from = binding.kind === "source" ? binding.nodeId : binding.stepId;
      if (ids.has(from))
        links.push({ kind: "data", from, to: target.id, parameter });
    }
  }
  return links;
}

/** A stable key; a parameter accepts one binding and two nodes one flow edge. */
export function planLinkKey(link: PlanLink): string {
  return link.kind === "flow"
    ? `flow:${link.from}:${link.to}`
    : `data:${link.to}:${link.parameter}`;
}

/** Removes exactly this connection; both of its nodes stay in the plan. */
export function removePlanLink(
  draft: AgentPlanInput,
  link: PlanLink,
): AgentPlanInput {
  if (link.kind === "flow")
    return {
      ...draft,
      edges: draft.edges.filter(
        (edge) => edge.from !== link.from || edge.to !== link.to,
      ),
    };
  return {
    ...draft,
    nodes: draft.nodes.map((node) => {
      if (
        node.id !== link.to ||
        (node.type !== "agent" && node.type !== "group")
      )
        return node;
      const bindings = Object.fromEntries(
        Object.entries(node.bindings).filter(
          ([parameter]) => parameter !== link.parameter,
        ),
      );
      return { ...node, bindings };
    }),
  };
}

/**
 * Names both ends of a connection, and the parameter of a data connection.
 *
 * @returns Text such as `Start → Review` or `Ticket → Review · ticket`.
 */
export function planLinkLabel(
  draft: AgentPlanInput,
  sources: AgentPlanSources,
  link: PlanLink,
): string {
  function label(id: string): string {
    const node = draft.nodes.find((entry) => entry.id === id);
    return node ? planNodeLabel(node, sources) : id;
  }
  const ends = `${label(link.from)} → ${label(link.to)}`;
  return link.kind === "data" ? `${ends} · ${link.parameter}` : ends;
}
