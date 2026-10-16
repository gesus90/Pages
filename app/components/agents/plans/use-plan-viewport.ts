import { useEffect, useRef, useState } from "react";

import type { AgentPlanPosition } from "@/definition/AgentPlan";

const MINIMUM_ZOOM = 0.25;
const MAXIMUM_ZOOM = 2;
// Pixels a press may travel and still count as a click on the empty grid.
const CLICK_TOLERANCE = 4;
// Interactive parts of the grid keep their own pointer behaviour.
const INTERACTIVE =
  "article, button, a, input, select, textarea, [data-plan-link]";

/** Offset in screen pixels and scale of the grid inside its viewport. */
export interface PlanView {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

interface PanStart {
  readonly pointerId: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly view: PlanView;
  hasMoved: boolean;
}

/** Pointer handlers the viewport element spreads onto itself. */
export interface PlanViewportPointer {
  readonly onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  readonly onPointerMove: (event: React.PointerEvent<HTMLElement>) => void;
  readonly onPointerUp: (event: React.PointerEvent<HTMLElement>) => void;
  readonly onPointerCancel: (event: React.PointerEvent<HTMLElement>) => void;
}

/** Pan and zoom state of the plan grid with the conversions that depend on it. */
export interface PlanViewport {
  readonly view: PlanView;
  readonly viewportRef: React.RefObject<HTMLDivElement | null>;
  readonly pointer: PlanViewportPointer;
  /** Zooms around the centre of the viewport, for the zoom buttons. */
  readonly zoomBy: (factor: number) => void;
  readonly reset: () => void;
  /** Converts a screen position into grid coordinates. */
  readonly toGrid: (clientX: number, clientY: number) => AgentPlanPosition;
}

/**
 * Scales the grid around a fixed point of the viewport.
 *
 * @param view - The current view.
 * @param point - Position in viewport pixels that stays under the pointer.
 * @param factor - Relative change; the result stays within the zoom limits.
 * @returns The view whose grid content under `point` did not move.
 */
export function zoomPlanView(
  view: PlanView,
  point: { readonly x: number; readonly y: number },
  factor: number,
): PlanView {
  const zoom = Math.min(
    MAXIMUM_ZOOM,
    Math.max(MINIMUM_ZOOM, view.zoom * factor),
  );
  const ratio = zoom / view.zoom;
  return {
    zoom,
    x: point.x - (point.x - view.x) * ratio,
    y: point.y - (point.y - view.y) * ratio,
  };
}

function wheelFactor(event: WheelEvent): number {
  // Firefox reports line steps; the other engines report pixels.
  const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
  return Math.exp(-delta * 0.0015);
}

/**
 * Pans the grid by dragging its empty area and zooms it with the mouse wheel.
 *
 * @param onBackgroundClick - Called for a press on the empty grid that did not pan.
 * @param initial - The view at the start and after a reset, such as an
 * offset that keeps the first nodes clear of a panel floating over the grid.
 */
export function usePlanViewport(
  onBackgroundClick: () => void,
  initial: PlanView = { x: 0, y: 0, zoom: 1 },
): PlanViewport {
  const viewportRef = useRef<HTMLDivElement>(null);
  const panStart = useRef<PanStart | null>(null);
  const [view, setView] = useState<PlanView>(initial);
  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return undefined;
    // React registers wheel listeners as passive, so the page would scroll as well.
    const zoomWithWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const bounds = element.getBoundingClientRect();
      const point = {
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      };
      setView((previous) => zoomPlanView(previous, point, wheelFactor(event)));
    };
    element.addEventListener("wheel", zoomWithWheel, { passive: false });
    return () => element.removeEventListener("wheel", zoomWithWheel);
  }, []);
  function onPointerDown(event: React.PointerEvent<HTMLElement>): void {
    const target = event.target;
    if (event.button !== 0) return;
    if (target instanceof Element && target.closest(INTERACTIVE)) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    panStart.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      view,
      hasMoved: false,
    };
  }
  function onPointerMove(event: React.PointerEvent<HTMLElement>): void {
    const start = panStart.current;
    if (start?.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - start.clientX;
    const deltaY = event.clientY - start.clientY;
    if (Math.abs(deltaX) + Math.abs(deltaY) > CLICK_TOLERANCE)
      start.hasMoved = true;
    if (!start.hasMoved) return;
    setView({
      ...start.view,
      x: start.view.x + deltaX,
      y: start.view.y + deltaY,
    });
  }
  function onPointerUp(event: React.PointerEvent<HTMLElement>): void {
    const start = panStart.current;
    if (start?.pointerId !== event.pointerId) return;
    panStart.current = null;
    if (!start.hasMoved) onBackgroundClick();
  }
  function onPointerCancel(): void {
    panStart.current = null;
  }
  function center(): { readonly x: number; readonly y: number } {
    const bounds = viewportRef.current?.getBoundingClientRect();
    return bounds
      ? { x: bounds.width / 2, y: bounds.height / 2 }
      : { x: 0, y: 0 };
  }
  function toGrid(clientX: number, clientY: number): AgentPlanPosition {
    const bounds = viewportRef.current?.getBoundingClientRect();
    return {
      x: (clientX - (bounds?.left ?? 0) - view.x) / view.zoom,
      y: (clientY - (bounds?.top ?? 0) - view.y) / view.zoom,
    };
  }
  return {
    view,
    viewportRef,
    pointer: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel },
    zoomBy: (factor) =>
      setView((previous) => zoomPlanView(previous, center(), factor)),
    reset: () => setView(initial),
    toGrid,
  };
}
