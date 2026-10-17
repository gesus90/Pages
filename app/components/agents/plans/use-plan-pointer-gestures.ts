import { useRef } from "react";

import { usePlanLinkDrag } from "./use-plan-link-drag";
import { usePlanNodeMove } from "./use-plan-node-move";

import type {
  AgentPlanInput,
  AgentPlanPosition,
  AgentPlanSources,
} from "@/definition/AgentPlan";
import type { PlanGraphActions } from "./use-plan-graph";
import type { PlanLinkGesture, PlanLinkPreview } from "./use-plan-link-drag";
import type { PlanNodeGesture, PlanNodePreview } from "./use-plan-node-move";

// Pixels a press may travel and still count as a click on its button.
const CLICK_TOLERANCE = 4;

interface Press {
  readonly pointerId: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly gesture: PlanNodeGesture | PlanLinkGesture;
  hasMoved: boolean;
}

/** Pointer gestures of the grid besides panning: moving nodes and dragging connections. */
export interface PlanPointerGestures {
  readonly nodePreview: PlanNodePreview | null;
  readonly linkPreview: PlanLinkPreview | null;
  /** The frame an agent being moved would join or stay in. */
  readonly dropTarget: string | null;
  readonly onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  readonly onPointerMove: (event: React.PointerEvent<HTMLElement>) => void;
  readonly onPointerUp: (event: React.PointerEvent<HTMLElement>) => void;
  /** Ends a gesture without a change: a moved node returns, a dragged connection is dropped. */
  readonly cancel: () => void;
}

/**
 * Moves nodes by their handle and drags connections from an OUT to an IN.
 *
 * @remarks
 * A press only becomes a gesture once it travels further than a click, so
 * the handle and the OUT keep their click actions for keyboard and touch
 * use. A gesture captures the pointer on the grid, which then neither pans
 * nor sends the click to the button where the press began.
 */
export function usePlanPointerGestures(options: {
  readonly draft: AgentPlanInput;
  readonly sources: AgentPlanSources;
  readonly graph: PlanGraphActions;
  readonly canEdit: boolean;
  readonly toGrid: (clientX: number, clientY: number) => AgentPlanPosition;
}): PlanPointerGestures {
  const { graph, toGrid } = options;
  const press = useRef<Press | null>(null);
  const nodes = usePlanNodeMove(options);
  const links = usePlanLinkDrag(options);
  function gestureAt(
    event: React.PointerEvent<HTMLElement>,
  ): PlanNodeGesture | PlanLinkGesture | null {
    const target = event.target instanceof Element ? event.target : null;
    const handle = target?.closest("[data-plan-handle]");
    if (handle instanceof HTMLElement && handle.dataset.planHandle)
      return nodes.grab(
        handle.dataset.planHandle,
        toGrid(event.clientX, event.clientY),
      );
    const out = target?.closest("[data-plan-out]");
    return out instanceof HTMLElement ? links.grab(out) : null;
  }
  function onPointerDown(event: React.PointerEvent<HTMLElement>): void {
    if (event.button !== 0 || !options.canEdit) return;
    const gesture = gestureAt(event);
    if (!gesture) return;
    press.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      gesture,
      hasMoved: false,
    };
  }
  function start(event: React.PointerEvent<HTMLElement>, current: Press): void {
    current.hasMoved = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    const { gesture } = current;
    if (gesture.kind === "node") graph.select(gesture.id);
    else graph.begin(gesture.connection);
  }
  function onPointerMove(event: React.PointerEvent<HTMLElement>): void {
    const current = press.current;
    if (current?.pointerId !== event.pointerId) return;
    const distance =
      Math.abs(event.clientX - current.clientX) +
      Math.abs(event.clientY - current.clientY);
    if (!current.hasMoved && distance <= CLICK_TOLERANCE) return;
    if (!current.hasMoved) start(event, current);
    const { gesture } = current;
    if (gesture.kind === "node")
      nodes.move(gesture, toGrid(event.clientX, event.clientY));
    else links.move(gesture, event);
  }
  function clear(): Press | null {
    const current = press.current;
    press.current = null;
    nodes.clear();
    links.clear();
    return current;
  }
  function onPointerUp(event: React.PointerEvent<HTMLElement>): void {
    if (press.current?.pointerId !== event.pointerId) return;
    const current = clear();
    if (!current?.hasMoved) return;
    const { gesture } = current;
    if (gesture.kind === "node")
      nodes.finish(gesture, toGrid(event.clientX, event.clientY));
    else links.finish(event);
  }
  function cancel(): void {
    const current = clear();
    if (!current?.hasMoved) return;
    if (current.gesture.kind === "node") nodes.cancel(current.gesture);
    else graph.begin(null);
  }
  return {
    nodePreview: nodes.preview,
    linkPreview: links.preview,
    dropTarget: nodes.dropTarget,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    cancel,
  };
}
