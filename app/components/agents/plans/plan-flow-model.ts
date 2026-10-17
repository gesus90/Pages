import { MarkerType } from "@xyflow/react";

import { isPlanFlowNode } from "@/definition/AgentPlanGraph";

import {
  PLAN_FRAME_PADDING,
  planGroupHeaderHeight,
  planNodeHeight,
  planNodeLabel,
  planNodeWidth,
} from "./plan-layout";
import { planLinkKey, planLinkLabel, planLinks } from "./plan-links";
import styles from "./plan-canvas.module.css";

import type { Connection, Edge, Node } from "@xyflow/react";
import type {
  AgentPlanInput,
  AgentPlanNode,
  AgentPlanSources,
} from "@/definition/AgentPlan";
import type { PlanLink } from "./plan-links";
import type { PlanConnection } from "./use-plan-connections";

/** A projection of a Pages node; React Flow metadata is never saved as a plan. */
export type PlanFlowNode = Node<{ readonly node: AgentPlanNode }, "plan">;

/** A rendered connection keeps the domain link used by selection and removal. */
export type PlanFlowEdge = Edge<
  { readonly link: PlanLink; readonly name: string },
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
  },
): PlanFlowNode[] {
  function project(node: AgentPlanNode, parentId?: string): PlanFlowNode {
    const width = planNodeWidth(node);
    const height = planNodeHeight(node, options.sources);
    return {
      id: node.id,
      type: "plan",
      data: { node },
      position: { x: node.x, y: node.y },
      selected: node.id === options.selectedId,
      draggable: options.canEdit,
      deletable: false,
      dragHandle: "[data-plan-handle]",
      className: node.type === "group" ? styles.groupNode : undefined,
      ariaLabel: planNodeLabel(node, options.sources),
      initialWidth: width,
      initialHeight: height,
      style: { width, height },
      ...(parentId ? { parentId } : {}),
    };
  }
  return plan.nodes.flatMap((node) => {
    const parent = project(node);
    if (node.type !== "group") return [parent];
    return [
      parent,
      ...node.steps.map((step) => ({
        ...project(step, node.id),
        position: {
          x: step.x + PLAN_FRAME_PADDING,
          y: step.y + planGroupHeaderHeight(node),
        },
      })),
    ];
  });
}

/** Projects execution edges and data bindings separately, including group boundary sources. */
export function planFlowEdges(
  plan: AgentPlanInput,
  sources: AgentPlanSources,
  selected: PlanLink | null,
): PlanFlowEdge[] {
  const selectedKey = selected ? planLinkKey(selected) : null;
  return planLinks(plan).map((link) => ({
    id: planLinkKey(link),
    type: "plan",
    source: link.from,
    target: link.to,
    sourceHandle: sourceHandle(link),
    targetHandle: link.kind === "flow" ? "flow-in" : `input:${link.parameter}`,
    data: { link, name: planLinkLabel(plan, sources, link) },
    selected: planLinkKey(link) === selectedKey,
    deletable: false,
    reconnectable: false,
    zIndex: 1,
    ariaLabel: planLinkLabel(plan, sources, link),
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: "var(--color-muted-foreground)",
    },
  }));
}

function sourceHandle(link: PlanLink): string {
  if (link.kind === "flow") return "flow-out";
  return link.port === undefined ? "value-out" : `boundary:${link.port}`;
}

/** Resolves a visible source handle to its Pages source, including a group's port ID. */
export function planFlowSource(
  plan: AgentPlanInput,
  id: string,
  handle: string | null,
): PlanConnection | null {
  const node =
    plan.nodes.find((entry) => entry.id === id) ??
    plan.nodes
      .flatMap((entry) => (entry.type === "group" ? entry.steps : []))
      .find((entry) => entry.id === id);
  if (!node) return null;
  if (handle === "flow-out" && isPlanFlowNode(node) && node.type !== "end")
    return { kind: "flow", nodeId: id };
  if (handle === "value-out" && node.type === "agent")
    return { kind: "result", nodeId: id };
  if (
    handle === "value-out" &&
    ["task", "parameter", "variable"].includes(node.type)
  )
    return { kind: "source", nodeId: id };
  if (node.type !== "group" || !handle?.startsWith("boundary:")) return null;
  const port = node.parameters.find(
    (entry) => `boundary:${entry.id}` === handle,
  );
  return port ? { kind: "source", nodeId: port.id } : null;
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
