import { useRef, useState } from "react";

import { findPlanStep } from "@/definition/AgentPlanGroupEdit";

import { PLAN_AGENT_DRAG, readPlanDrag } from "./plan-drag";
import { planDropGroup } from "./plan-layout";

import type {
  AgentPlanInput,
  AgentPlanPosition,
  AgentPlanSources,
} from "@/definition/AgentPlan";
import type { PlanGraphActions } from "./use-plan-graph";

/** Drag and drop on the plan grid, including the frame an agent would land in. */
export interface PlanCanvasDrop {
  /** The frame under the pointer that would take the agent being dragged. */
  readonly dropTarget: string | null;
  /** Remembers which node of the grid is dragged, so its own frame keeps it near the edge. */
  readonly startNodeDrag: (id: string) => void;
  readonly onDragOver: (event: React.DragEvent<HTMLElement>) => void;
  readonly onDragLeave: (event: React.DragEvent<HTMLElement>) => void;
  readonly onDrop: (event: React.DragEvent<HTMLElement>) => void;
}

/**
 * Places dropped nodes and sources at the pointer, with the zoom and offset of the grid.
 *
 * @remarks
 * A node keeps the point where it was grabbed under the pointer. Whether an
 * agent joins, stays in or leaves a frame depends on the pointer alone and is
 * shown while dragging.
 */
export function usePlanCanvasDrop(options: {
  readonly draft: AgentPlanInput;
  readonly sources: AgentPlanSources;
  readonly graph: PlanGraphActions;
  readonly canEdit: boolean;
  readonly toGrid: (clientX: number, clientY: number) => AgentPlanPosition;
}): PlanCanvasDrop {
  const { draft, sources, graph, canEdit, toGrid } = options;
  const dragged = useRef<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  function memberOf(): string | null {
    const id = dragged.current;
    return id === null ? null : (findPlanStep(draft, id)?.group?.id ?? null);
  }
  function onDragOver(event: React.DragEvent<HTMLElement>): void {
    event.preventDefault();
    const isAgent = event.dataTransfer.types.includes(PLAN_AGENT_DRAG);
    const group =
      canEdit && isAgent
        ? planDropGroup(
            draft,
            toGrid(event.clientX, event.clientY),
            sources,
            memberOf(),
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
  function placeNode(
    id: string,
    pointer: AgentPlanPosition,
    position: AgentPlanPosition,
  ): void {
    if (findPlanStep(draft, id)) {
      graph.place(id, { pointer, position });
      return;
    }
    graph.move(id, Math.max(0, position.x), Math.max(0, position.y));
  }
  function onDrop(event: React.DragEvent<HTMLElement>): void {
    event.preventDefault();
    const carried = readPlanDrag(event.dataTransfer);
    dragged.current = null;
    setDropTarget(null);
    if (!canEdit || !carried) return;
    const pointer = toGrid(event.clientX, event.clientY);
    if (carried.kind === "node") {
      placeNode(carried.reference, pointer, {
        x: pointer.x - carried.offset.x,
        y: pointer.y - carried.offset.y,
      });
      return;
    }
    if (carried.kind === "agent") {
      const group = planDropGroup(draft, pointer, sources, null);
      graph.add("agent", carried.reference, pointer, group?.id);
    }
    if (carried.kind === "task" || carried.kind === "variable")
      graph.add(carried.kind, carried.reference, pointer);
  }
  return {
    dropTarget,
    startNodeDrag: (id) => {
      dragged.current = id;
    },
    onDragOver,
    onDragLeave,
    onDrop,
  };
}
