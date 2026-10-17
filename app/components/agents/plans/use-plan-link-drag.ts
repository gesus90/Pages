import { useState } from "react";

import type { AgentPlanPosition } from "@/definition/AgentPlan";
import type { PlanGraphActions } from "./use-plan-graph";

type PlanConnectionKind = "flow" | "source" | "result";

/** An IN a connection is dragged over. */
export interface PlanPortTarget {
  readonly id: string;
  readonly parameter?: string;
}

/** The line from the OUT being dragged to the pointer, in grid coordinates. */
export interface PlanLinkPreview {
  readonly from: AgentPlanPosition;
  readonly to: AgentPlanPosition;
  readonly target: PlanPortTarget | null;
}

/** A connection being dragged from an OUT. */
export interface PlanLinkGesture {
  readonly kind: "link";
  readonly connection: {
    readonly kind: PlanConnectionKind;
    readonly nodeId: string;
  };
  readonly from: AgentPlanPosition;
}

/** Dragging one connection from an OUT to an IN. */
export interface PlanLinkDrag {
  readonly preview: PlanLinkPreview | null;
  readonly grab: (element: HTMLElement) => PlanLinkGesture | null;
  readonly move: (
    gesture: PlanLinkGesture,
    event: React.PointerEvent<HTMLElement>,
  ) => void;
  readonly finish: (event: React.PointerEvent<HTMLElement>) => void;
  readonly clear: () => void;
}

function isConnectionKind(
  kind: string | undefined,
): kind is PlanConnectionKind {
  return kind === "flow" || kind === "source" || kind === "result";
}

/** The IN under the pointer, found by the attributes the ports carry. */
function portTargetAt(clientX: number, clientY: number): PlanPortTarget | null {
  const element = document.elementFromPoint(clientX, clientY);
  const port =
    element instanceof Element ? element.closest("[data-plan-in]") : null;
  if (!(port instanceof HTMLElement) || !port.dataset.planIn) return null;
  return { id: port.dataset.planIn, parameter: port.dataset.planParameter };
}

/**
 * Draws a connection from an OUT to the pointer and connects it on release over an IN.
 *
 * @remarks
 * Ports are found below the pointer by their `data-plan-in` and
 * `data-plan-out` attributes, so a card needs no handlers of its own. The
 * rules are those of a click on the OUT and then on the IN: a refused IN
 * keeps the connection open with its issue, a release elsewhere drops it.
 */
export function usePlanLinkDrag(options: {
  readonly graph: PlanGraphActions;
  readonly toGrid: (clientX: number, clientY: number) => AgentPlanPosition;
}): PlanLinkDrag {
  const { graph, toGrid } = options;
  const [preview, setPreview] = useState<PlanLinkPreview | null>(null);
  function grab(element: HTMLElement): PlanLinkGesture | null {
    const nodeId = element.dataset.planOut;
    const kind = element.dataset.planOutKind;
    if (!nodeId || !isConnectionKind(kind)) return null;
    const bounds = element.getBoundingClientRect();
    return {
      kind: "link",
      connection: { kind, nodeId },
      from: toGrid(
        bounds.left + bounds.width / 2,
        bounds.top + bounds.height / 2,
      ),
    };
  }
  function move(
    gesture: PlanLinkGesture,
    event: React.PointerEvent<HTMLElement>,
  ): void {
    setPreview({
      from: gesture.from,
      to: toGrid(event.clientX, event.clientY),
      target: portTargetAt(event.clientX, event.clientY),
    });
  }
  function finish(event: React.PointerEvent<HTMLElement>): void {
    const target = portTargetAt(event.clientX, event.clientY);
    if (target) graph.connect(target.id, target.parameter);
    else graph.begin(null);
  }
  return { preview, grab, move, finish, clear: () => setPreview(null) };
}
