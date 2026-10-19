import type { ReactFlowInstance } from "@xyflow/react";
import type { PlanFlowEdge, PlanFlowNode } from "./plan-flow-model";

function canvasRightEdge(
  panel: HTMLElement,
  bounds: DOMRect,
  top: number,
): number {
  const palette = panel.parentElement
    ?.querySelector("[data-plan-palette]")
    ?.getBoundingClientRect();
  if (palette && palette.bottom > bounds.top + top)
    return palette.left - bounds.left - 16;
  return bounds.width - 16;
}

/** Explicit navigation fits the requested node between the run controls, palette and status panel. */
export function focusStatusNode(
  flow: ReactFlowInstance<PlanFlowNode, PlanFlowEdge>,
  id: string,
  panel: HTMLElement | null,
): void {
  const node = flow.getInternalNode(id);
  const bounds = panel?.parentElement?.getBoundingClientRect();
  if (!node || !panel || !bounds) return;
  const upper = panel.parentElement
    ?.querySelector("[data-plan-upper-stack]")
    ?.getBoundingClientRect();
  const top = Math.max(16, (upper?.bottom ?? bounds.top) - bounds.top + 16);
  const bottom = panel.getBoundingClientRect().top - bounds.top - 16;
  const right = canvasRightEdge(panel, bounds, top);
  const width = node.measured.width ?? 280;
  const height = node.measured.height ?? 200;
  const zoom = Math.max(
    0.01,
    Math.min(
      1,
      Math.max(48, right - 16) / (width + 32),
      Math.max(48, bottom - top) / (height + 32),
    ),
  );
  const position = node.internals.positionAbsolute;
  void flow.setViewport({
    x: (16 + right) / 2 - (position.x + width / 2) * zoom,
    y: (top + bottom) / 2 - (position.y + height / 2) * zoom,
    zoom,
  });
}
