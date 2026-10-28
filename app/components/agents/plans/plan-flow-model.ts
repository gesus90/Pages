import { MarkerType } from "@xyflow/react";

import { isPlanFlowNode, isPlanResultNode } from "@/definition/AgentPlanGraph";
import { planLoopEntries, planLoopExits } from "@/definition/AgentPlanLoop";

import {
  PLAN_FRAME_PADDING,
  PLAN_GROUP_COMPACT_WIDTH,
  PLAN_GROUP_COMPACT_HEIGHT,
  planGroupHeaderHeight,
  planNodeHeight,
  planNodeLabel,
  planNodeWidth,
} from "./plan-layout";
import { planLinkKey, planLinkLabel, planLinks } from "./plan-links";
import { planGroupRouteLabel } from "./plan-group-routing";
import styles from "./plan-canvas.module.css";

import type { Connection, Edge, Node } from "@xyflow/react";
import type {
  AgentPlanInput,
  AgentPlanNode,
  AgentPlanSources,
} from "@/definition/AgentPlan";
import type { AgentPlanLoop } from "@/definition/AgentPlanLoop";
import type { PlanLink } from "./plan-links";
import type { PlanConnection } from "./use-plan-connections";

// Layers of the canvas (React Flow's manual z-index mode): frames lie below
// the connections, cards above them, so a line never crosses a card or its
// text; the labels of connections lie in between (plan-canvas.module.css).
const FRAME_LAYER = 0;
const EDGE_LAYER = 1;
const CARD_LAYER = 3;

/** A projection of a Pages node; React Flow metadata is never saved as a plan. */
export type PlanFlowNode = Node<{ readonly node: AgentPlanNode }, "plan">;

/** A rendered connection keeps the domain link used by selection and removal. */
export type PlanFlowEdge = Edge<
  {
    readonly link: PlanLink;
    readonly name: string;
    readonly routeEnd?: "from" | "to";
    readonly routeLabelOffsetY?: number;
    /** A line from a loop's entry dot to a member or from a member to its exit dot; it has no label and is not selectable. */
    readonly isBoundary?: boolean;
  },
  "plan"
>;

/** One validated port request, independent of React Flow's transient connection state. */
export interface PlanFlowConnection {
  readonly source: PlanConnection;
  readonly targetId: string;
  readonly parameter?: string;
}

/**
 * Projects every node and member without reconstructing any domain fields.
 * Parents precede children; stored member coordinates count from the member area.
 */
export function planFlowNodes(
  plan: AgentPlanInput,
  options: {
    readonly sources: AgentPlanSources;
    readonly selectedId: string | null;
    readonly canEdit: boolean;
    readonly collapsedGroups?: ReadonlySet<string>;
  },
): PlanFlowNode[] {
  function project(node: AgentPlanNode, parentId?: string): PlanFlowNode {
    const isCollapsed =
      node.type === "group" && options.collapsedGroups?.has(node.id);
    const width = isCollapsed ? PLAN_GROUP_COMPACT_WIDTH : planNodeWidth(node);
    const height = isCollapsed
      ? PLAN_GROUP_COMPACT_HEIGHT
      : planNodeHeight(node, options.sources);
    const isFrame = node.type === "group" || node.type === "loop";
    const isEndpoint = node.type === "start" || node.type === "end";
    return {
      id: node.id,
      type: "plan",
      data: { node },
      position: { x: node.x, y: node.y },
      selected: node.id === options.selectedId,
      draggable: options.canEdit,
      deletable: false,
      dragHandle: "[data-plan-handle]",
      zIndex: isFrame ? FRAME_LAYER : CARD_LAYER,
      className: isFrame ? styles.groupNode : styles.cardNode,
      ariaLabel: planNodeLabel(node, options.sources),
      initialWidth: width,
      initialHeight: height,
      style: cardStyle(width, height, { isFrame, isEndpoint }),
      ...(parentId ? { parentId } : {}),
    };
  }
  return plan.nodes.flatMap((node) => {
    const parent = project(node);
    if (node.type !== "group" && node.type !== "loop") return [parent];
    return [
      parent,
      ...node.steps.map((step) => ({
        ...project(step, node.id),
        hidden: options.collapsedGroups?.has(node.id) ?? false,
        position: {
          x: step.x + PLAN_FRAME_PADDING,
          y: step.y + planGroupHeaderHeight(),
        },
      })),
    ];
  });
}

/**
 * A frame keeps its computed size; a card grows with larger text, and start
 * and end also grow wide enough for their name, status and menu. React Flow
 * then measures the ports again.
 */
function cardStyle(
  width: number,
  height: number,
  kind: { readonly isFrame: boolean; readonly isEndpoint: boolean },
): React.CSSProperties {
  if (kind.isFrame) return { width, height };
  if (kind.isEndpoint) return { minWidth: width, minHeight: height };
  return { width, minHeight: height };
}

/** Projects execution edges and data bindings separately, with noninteractive routes for collapsed members. */
export function planFlowEdges(
  plan: AgentPlanInput,
  sources: AgentPlanSources,
  selected: PlanLink | null,
  collapsedGroups: ReadonlySet<string> = new Set(),
): PlanFlowEdge[] {
  const selectedKey = selected ? planLinkKey(selected) : null;
  function frame(id: string): string {
    return (
      plan.nodes.find(
        (node) =>
          node.type === "group" &&
          collapsedGroups.has(node.id) &&
          node.steps.some((step) => step.id === id),
      )?.id ?? id
    );
  }
  const legacyFrames = new Set(
    plan.nodes.filter((node) => node.type === "group").map((node) => node.id),
  );
  const boundary = plan.nodes.flatMap((node) =>
    node.type === "loop" ? loopBoundaryEdges(node) : [],
  );
  const links: PlanFlowEdge[] = planLinks(plan)
    .filter(
      (link) => !legacyFrames.has(link.from) && !legacyFrames.has(link.to),
    )
    .filter((link) => frame(link.from) !== frame(link.to))
    .map((link) => ({
      id: planLinkKey(link),
      type: "plan",
      source: frame(link.from),
      target: frame(link.to),
      sourceHandle:
        frame(link.from) === link.from
          ? sourceHandle(link)
          : `route:${planLinkKey(link)}:from`,
      targetHandle: targetHandle(link, frame(link.to)),
      data: {
        link,
        name: planLinkLabel(plan, sources, link),
        ...planGroupRouteLabel(plan, link, collapsedGroups),
      },
      selected: planLinkKey(link) === selectedKey,
      deletable: false,
      reconnectable: false,
      zIndex: EDGE_LAYER,
      ariaLabel: planLinkLabel(plan, sources, link),
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: "var(--color-muted-foreground)",
      },
    }));
  return [...boundary, ...links];
}

/** The lines from a loop's entry dot to its first members and from its last members to its exit dot. */
function loopBoundaryEdges(loop: AgentPlanLoop): PlanFlowEdge[] {
  const base = {
    type: "plan" as const,
    selectable: false,
    focusable: false,
    deletable: false,
    reconnectable: false,
    zIndex: EDGE_LAYER,
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: "var(--color-muted-foreground)",
    },
  };
  return [
    ...planLoopEntries(loop).map((entry): PlanFlowEdge => ({
      ...base,
      id: `loop-in:${loop.id}:${entry.id}`,
      source: loop.id,
      sourceHandle: "inner-in",
      target: entry.id,
      targetHandle: "flow-in",
      data: {
        link: { kind: "flow", from: loop.id, to: entry.id },
        name: "",
        isBoundary: true,
      },
    })),
    ...planLoopExits(loop).map((exit): PlanFlowEdge => ({
      ...base,
      id: `loop-out:${loop.id}:${exit.id}`,
      source: exit.id,
      sourceHandle: "flow-out",
      target: loop.id,
      targetHandle: "inner-out",
      data: {
        link: { kind: "flow", from: exit.id, to: loop.id },
        name: "",
        isBoundary: true,
      },
    })),
  ];
}

function targetHandle(link: PlanLink, targetId: string): string {
  if (targetId !== link.to) return `route:${planLinkKey(link)}:to`;
  return link.kind === "flow" ? "flow-in" : `input:${link.parameter}`;
}

// A data link with a boundary port starts at its legacy group frame, and
// links of such a frame are never drawn; every drawn data link leaves a value OUT.
function sourceHandle(link: PlanLink): string {
  return link.kind === "flow" ? "flow-out" : "value-out";
}

/** Resolves a visible source handle to its Pages source, never a visual group route. */
export function planFlowSource(
  plan: AgentPlanInput,
  id: string,
  handle: string | null,
): PlanConnection | null {
  const node =
    plan.nodes.find((entry) => entry.id === id) ??
    plan.nodes
      .flatMap((entry) =>
        entry.type === "group" || entry.type === "loop" ? entry.steps : [],
      )
      .find((entry) => entry.id === id);
  if (!node) return null;
  if (handle === "flow-out" && isPlanFlowNode(node) && node.type !== "end")
    return { kind: "flow", nodeId: id };
  if (handle === "value-out" && isPlanResultNode(node))
    return { kind: "result", nodeId: id };
  if (
    handle === "value-out" &&
    ["task", "parameter", "variable"].includes(node.type)
  )
    return { kind: "source", nodeId: id };
  return null;
}

/** Converts only explicit, known handle kinds into a domain connection request. */
export function planFlowConnection(
  plan: AgentPlanInput,
  connection: Connection,
): PlanFlowConnection | null {
  const source = planFlowSource(
    plan,
    connection.source,
    connection.sourceHandle,
  );
  if (!source) return null;
  if (connection.targetHandle === "flow-in")
    return { source, targetId: connection.target };
  if (!connection.targetHandle?.startsWith("input:")) return null;
  return {
    source,
    targetId: connection.target,
    parameter: connection.targetHandle.slice("input:".length),
  };
}
