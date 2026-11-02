import { planEdgeBranch, planEdgeKind } from "@/definition/AgentPlanBranching";
import { disconnectPlanEdge } from "@/definition/AgentPlanBranchingEdit";
import { allPlanSteps, planGroupEdges } from "@/definition/AgentPlanGroup";
import { allPlanLoopMembers } from "@/definition/AgentPlanLoop";
import { disconnectLoopFlow } from "@/definition/AgentPlanLoopEdit";
import {
  disconnectPlanGroupFlow,
  findPlanBindingTarget,
  findPlanStep,
  replacePlanNode,
} from "@/definition/AgentPlanGroupEdit";

import { planNodeLabel } from "./plan-layout";

import type {
  AgentPlanBinding,
  AgentPlanEdge,
  AgentPlanInput,
  AgentPlanSources,
  AgentPlanStep,
} from "@/definition/AgentPlan";
import type { AgentPlanBranch } from "@/definition/AgentPlanBranching";
import type { AgentPlanGroup } from "@/definition/AgentPlanGroup";
import type { AgentPlanLoop } from "@/definition/AgentPlanLoop";
import type { AgentPlanScript } from "@/definition/AgentPlanScript";

/** A flow edge between steps; it orders execution. */
interface PlanFlowLink {
  readonly kind: "flow";
  readonly from: string;
  readonly to: string;
  /** The frame of an edge between two of its members. */
  readonly groupId?: string;
  /** The loop of an edge between two of its members. */
  readonly loopId?: string;
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

/** What a wire between two ports carries: a result into a decision, a branch out of it or a new prompt. */
export type PlanWireChannel = "branch" | "condition" | "event";

/**
 * An edge of the branching contract: the boolean result of an agent into a
 * decision, an output of a decision into a flow input, or the text result of a
 * node into the event input of an agent.
 *
 * @remarks
 * Only the first two order execution; an event never does. The ports name the
 * handles the line starts and ends at, so two wires between the same nodes
 * stay apart.
 */
interface PlanWireLink {
  readonly kind: "wire";
  readonly channel: PlanWireChannel;
  readonly from: string;
  readonly to: string;
  readonly fromPort: string;
  readonly toPort: string;
  /** The output of a decision a `branch` wire leaves through. */
  readonly branch?: AgentPlanBranch;
}

/** One connection the grid draws, selects and removes on its own. */
export type PlanLink = PlanFlowLink | PlanDataLink | PlanWireLink;

/**
 * How a connection is drawn and named: its line, its colour and its label.
 *
 * @remarks
 * The two branches have a channel each, so that the colour is never the only
 * difference between them.
 */
export type PlanLinkChannel =
  "flow" | "data" | "condition" | "true" | "false" | "event";

/** The drawing channel of a connection. */
export function planLinkChannel(link: PlanLink): PlanLinkChannel {
  if (link.kind !== "wire") return link.kind;
  if (link.channel === "branch")
    return link.branch === "false" ? "false" : "true";
  return link.channel;
}

/** The connection an edge of the plan draws; an unknown pair of ports stays a plain flow line. */
function edgeLink(edge: AgentPlanEdge): PlanLink {
  const kind = planEdgeKind(edge);
  if (kind === null || kind === "flow")
    return { kind: "flow", from: edge.from, to: edge.to };
  const branch = planEdgeBranch(edge);
  return {
    kind: "wire",
    channel: kind,
    from: edge.from,
    to: edge.to,
    fromPort: edge.fromPort,
    toPort: edge.toPort,
    ...(branch ? { branch } : {}),
  };
}

/** Whether the edge orders execution as a plain flow line, as every edge did before decisions. */
function isPlainFlow(edge: AgentPlanEdge): boolean {
  const kind = planEdgeKind(edge);
  return kind === null || kind === "flow";
}

function bindingLinks(
  target: AgentPlanStep | AgentPlanScript | AgentPlanGroup,
  ids: ReadonlySet<string>,
  frame: AgentPlanGroup | null,
): readonly PlanLink[] {
  return Object.entries(target.bindings).flatMap(
    ([parameter, binding]: [string, AgentPlanBinding]): PlanLink[] => {
      // A previous iteration's result needs no line: the input names its source, and a
      // line from a later member back to an earlier one would cross every card between them.
      if (binding.kind === "literal" || binding.kind === "previous") return [];
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

/** The internal flow edges and member bindings of a loop. */
function loopLinks(
  loop: AgentPlanLoop,
  ids: ReadonlySet<string>,
): readonly PlanLink[] {
  const edges = loop.edges
    .filter((edge) => ids.has(edge.from) && ids.has(edge.to))
    .map((edge): PlanLink => ({
      kind: "flow",
      from: edge.from,
      to: edge.to,
      loopId: loop.id,
    }));
  return [
    ...edges,
    ...loop.steps.flatMap((member) => bindingLinks(member, ids, null)),
  ];
}

/** Lists flow edges and parameter bindings whose two nodes both exist, inside frames too. */
export function planLinks(plan: AgentPlanInput): readonly PlanLink[] {
  const ids = new Set([
    ...plan.nodes.map((node) => node.id),
    ...allPlanSteps(plan).map((step) => step.id),
    ...allPlanLoopMembers(plan).map((step) => step.id),
  ]);
  const links: PlanLink[] = plan.edges
    .filter((edge) => ids.has(edge.from) && ids.has(edge.to))
    .map(edgeLink);
  for (const target of plan.nodes) {
    if (target.type === "agent" || target.type === "script")
      links.push(...bindingLinks(target, ids, null));
    if (target.type === "loop") links.push(...loopLinks(target, ids));
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

/**
 * A stable key; a parameter accepts one binding and two nodes one flow edge.
 *
 * @remarks
 * A plain flow keeps `flow:from:to`; a wire names its channel, and a branch
 * also its output, so that no two connections share a key.
 */
export function planLinkKey(link: PlanLink): string {
  if (link.kind === "data") return `data:${link.to}:${link.parameter}`;
  if (link.kind === "flow") return `flow:${link.from}:${link.to}`;
  const output = link.branch ? `:${link.branch}` : "";
  return `${link.channel}:${link.from}${output}:${link.to}`;
}

/** Removes exactly this connection; both of its nodes stay in the plan. */
export function removePlanLink(
  draft: AgentPlanInput,
  link: PlanLink,
): AgentPlanInput {
  if (link.kind === "flow" && link.loopId !== undefined)
    return disconnectLoopFlow(draft, link.loopId, link);
  if (link.kind === "flow" && link.groupId !== undefined)
    return disconnectPlanGroupFlow(draft, link.groupId, link);
  if (link.kind === "wire") return disconnectPlanEdge(draft, link);
  if (link.kind === "flow")
    return {
      ...draft,
      edges: draft.edges.filter(
        (edge) =>
          edge.from !== link.from || edge.to !== link.to || !isPlainFlow(edge),
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
