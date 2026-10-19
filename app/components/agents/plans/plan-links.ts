import { allPlanSteps, planGroupEdges } from "@/definition/AgentPlanGroup";
import {
  disconnectPlanGroupFlow,
  findPlanBindingTarget,
  findPlanStep,
  replacePlanNode,
} from "@/definition/AgentPlanGroupEdit";

import { planNodeLabel } from "./plan-layout";

import type {
  AgentPlanBinding,
  AgentPlanInput,
  AgentPlanSources,
  AgentPlanStep,
} from "@/definition/AgentPlan";
import type { AgentPlanGroup } from "@/definition/AgentPlanGroup";
import type { AgentPlanScript } from "@/definition/AgentPlanScript";

/** A flow edge between steps; it orders execution. */
interface PlanFlowLink {
  readonly kind: "flow";
  readonly from: string;
  readonly to: string;
  /** The frame of an edge between two of its members. */
  readonly groupId?: string;
}

/** A source or result bound to one named parameter of an agent node. */
interface PlanDataLink {
  readonly kind: "data";
  readonly from: string;
  readonly to: string;
  readonly parameter: string;
  /** The boundary port a member reads; `from` then names its frame. */
  readonly port?: string;
}

/** One connection the grid draws, selects and removes on its own. */
export type PlanLink = PlanFlowLink | PlanDataLink;

function bindingLinks(
  target: AgentPlanStep | AgentPlanScript | AgentPlanGroup,
  ids: ReadonlySet<string>,
  frame: AgentPlanGroup | null,
): readonly PlanLink[] {
  return Object.entries(target.bindings).flatMap(
    ([parameter, binding]: [string, AgentPlanBinding]): PlanLink[] => {
      if (binding.kind === "literal") return [];
      const from = binding.kind === "source" ? binding.nodeId : binding.stepId;
      const port = frame?.parameters.find((entry) => entry.id === from);
      if (frame && port)
        return [
          {
            kind: "data",
            from: frame.id,
            to: target.id,
            parameter,
            port: port.id,
          },
        ];
      return ids.has(from)
        ? [{ kind: "data", from, to: target.id, parameter }]
        : [];
    },
  );
}

/** Lists flow edges and parameter bindings whose two nodes both exist, inside frames too. */
export function planLinks(plan: AgentPlanInput): readonly PlanLink[] {
  const ids = new Set([
    ...plan.nodes.map((node) => node.id),
    ...allPlanSteps(plan).map((step) => step.id),
  ]);
  const links: PlanLink[] = plan.edges
    .filter((edge) => ids.has(edge.from) && ids.has(edge.to))
    .map((edge) => ({ kind: "flow", from: edge.from, to: edge.to }));
  for (const target of plan.nodes) {
    if (target.type === "agent" || target.type === "script")
      links.push(...bindingLinks(target, ids, null));
    if (target.type !== "group") continue;
    links.push(...bindingLinks(target, ids, null));
    for (const edge of planGroupEdges(target))
      if (ids.has(edge.from) && ids.has(edge.to))
        links.push({
          kind: "flow",
          from: edge.from,
          to: edge.to,
          groupId: target.id,
        });
    for (const step of target.steps)
      links.push(...bindingLinks(step, ids, target));
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
  if (link.kind === "flow" && link.groupId !== undefined)
    return disconnectPlanGroupFlow(draft, link.groupId, link);
  if (link.kind === "flow")
    return {
      ...draft,
      edges: draft.edges.filter(
        (edge) => edge.from !== link.from || edge.to !== link.to,
      ),
    };
  const target = findPlanBindingTarget(draft, link.to);
  if (!target) return draft;
  return replacePlanNode(draft, {
    ...target,
    bindings: Object.fromEntries(
      Object.entries(target.bindings).filter(
        ([parameter]) => parameter !== link.parameter,
      ),
    ),
  });
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
    const node =
      draft.nodes.find((entry) => entry.id === id) ??
      findPlanStep(draft, id)?.step;
    return node ? planNodeLabel(node, sources) : id;
  }
  const group =
    link.kind === "data" && link.port !== undefined
      ? draft.nodes.find((node) => node.id === link.from)
      : undefined;
  const port =
    group?.type === "group" && link.kind === "data"
      ? group.parameters.find((entry) => entry.id === link.port)?.name
      : undefined;
  const start = port ? `${label(link.from)} · ${port}` : label(link.from);
  const ends = `${start} → ${label(link.to)}`;
  return link.kind === "data" ? `${ends} · ${link.parameter}` : ends;
}
