import { planNodeWidth } from "./plan-layout";

import type { AgentPlanNode } from "@/definition/AgentPlan";

/** Marks a drag that carries an agent, which the grid can tell during the drag already. */
export const PLAN_AGENT_DRAG = "application/x-pages-plan-agent";

/** A node or source the grid receives, as the drag carried it. */
export interface PlanDragData {
  readonly kind: string;
  readonly reference: string;
  /** Where a node was grabbed, in grid units from its corner. */
  readonly offset: { readonly x: number; readonly y: number };
}

/** Reads the drag data of the plan grid; `null` for a drag from elsewhere. */
export function readPlanDrag(transfer: DataTransfer): PlanDragData | null {
  const [kind, reference, offsetX, offsetY] = transfer
    .getData("application/x-pages-plan")
    .split(":");
  if (!kind || !reference) return null;
  return {
    kind,
    reference,
    offset: { x: Number(offsetX) || 0, y: Number(offsetY) || 0 },
  };
}

/**
 * Starts dragging a node with the point where it was grabbed, in grid units.
 *
 * @remarks
 * The drop then places the node's corner where the card was released, so a
 * node keeps its place under the pointer, also when it leaves a frame.
 */
export function startPlanNodeDrag(
  event: React.DragEvent<HTMLElement>,
  node: AgentPlanNode,
): void {
  const card = event.currentTarget.closest("article, section");
  const bounds = card?.getBoundingClientRect();
  const zoom =
    bounds && bounds.width > 0 ? bounds.width / planNodeWidth(node) : 1;
  const offsetX = bounds ? Math.round((event.clientX - bounds.left) / zoom) : 0;
  const offsetY = bounds ? Math.round((event.clientY - bounds.top) / zoom) : 0;
  event.dataTransfer.setData(
    "application/x-pages-plan",
    `node:${node.id}:${offsetX}:${offsetY}`,
  );
  if (node.type === "agent")
    event.dataTransfer.setData(PLAN_AGENT_DRAG, node.id);
  event.dataTransfer.effectAllowed = "move";
}
