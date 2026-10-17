import { useState } from "react";

import { PLAN_AGENT_DRAG, readPlanDrag } from "./plan-drag";
import {
  PLAN_ENDPOINT_PORT_Y,
  PLAN_ENDPOINT_SIZE,
  planDropGroup,
} from "./plan-layout";

import type {
  AgentPlanInput,
  AgentPlanPosition,
  AgentPlanSources,
} from "@/definition/AgentPlan";
import type { PlanGraphActions } from "./use-plan-graph";

/** Drag and drop from the side panel onto the grid, including the frame an agent would land in. */
export interface PlanCanvasDrop {
  /** The frame under the pointer that would take the agent being dragged. */
  readonly dropTarget: string | null;
  readonly onDragOver: (event: React.DragEvent<HTMLElement>) => void;
  readonly onDragLeave: (event: React.DragEvent<HTMLElement>) => void;
  readonly onDrop: (event: React.DragEvent<HTMLElement>) => void;
}

/**
 * Places dropped sources at the pointer, with the zoom and offset of the grid.
 *
 * @remarks
 * Whether a new agent joins a frame depends on the pointer alone and is shown
 * while dragging. Start and end land with their circle under the pointer. A
 * drag that ends outside the grid or is cancelled adds nothing.
 */
export function usePlanCanvasDrop(options: {
  readonly draft: AgentPlanInput;
  readonly sources: AgentPlanSources;
  readonly graph: PlanGraphActions;
  readonly canEdit: boolean;
  readonly toGrid: (clientX: number, clientY: number) => AgentPlanPosition;
}): PlanCanvasDrop {
  const { draft, sources, graph, canEdit, toGrid } = options;
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  function onDragOver(event: React.DragEvent<HTMLElement>): void {
    event.preventDefault();
    const isAgent = event.dataTransfer.types.includes(PLAN_AGENT_DRAG);
    const group =
      canEdit && isAgent
        ? planDropGroup(
            draft,
            toGrid(event.clientX, event.clientY),
            sources,
            null,
          )
        : null;
    const next = group?.id ?? null;
    if (next !== dropTarget) setDropTarget(next);
  }
  function onDragLeave(event: React.DragEvent<HTMLElement>): void {
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    setDropTarget(null);
  }
  function onDrop(event: React.DragEvent<HTMLElement>): void {
    event.preventDefault();
    const carried = readPlanDrag(event.dataTransfer);
    setDropTarget(null);
    if (!canEdit || !carried) return;
    const pointer = toGrid(event.clientX, event.clientY);
    if (carried.kind === "agent") {
      const group = planDropGroup(draft, pointer, sources, null);
      graph.add("agent", carried.reference, pointer, group?.id);
    }
    if (carried.kind === "task" || carried.kind === "variable")
      graph.add(carried.kind, carried.reference, pointer);
    if (carried.kind === "start" || carried.kind === "end")
      graph.add(carried.kind, carried.kind, {
        x: pointer.x - PLAN_ENDPOINT_SIZE / 2,
        y: pointer.y - PLAN_ENDPOINT_PORT_Y,
      });
  }
  return { dropTarget, onDragOver, onDragLeave, onDrop };
}
