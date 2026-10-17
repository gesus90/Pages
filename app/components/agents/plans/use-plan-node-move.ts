import { useState } from "react";

import { findPlanStep } from "@/definition/AgentPlanGroupEdit";

import { planDropGroup, planMemberOrigin, planNodeBox } from "./plan-layout";
import { snapPlanCoordinate } from "./plan-node-factory";

import type {
  AgentPlanInput,
  AgentPlanPosition,
  AgentPlanSources,
} from "@/definition/AgentPlan";
import type { AgentPlanGroup } from "@/definition/AgentPlanGroup";
import type { PlanGraphActions } from "./use-plan-graph";

/** Where a dragged member of a frame would land, in absolute grid coordinates. */
export interface PlanNodePreview extends AgentPlanPosition {
  readonly id: string;
}

/** A node being moved by its handle. */
export interface PlanNodeGesture {
  readonly kind: "node";
  readonly id: string;
  /** Where the node was grabbed, in grid units from its corner. */
  readonly grab: AgentPlanPosition;
  /** The stored position, restored when the move is cancelled. */
  readonly origin: AgentPlanPosition;
  readonly isAgent: boolean;
  readonly memberOf: string | null;
}

/** Moving one node of the grid with the pointer. */
export interface PlanNodeMove {
  readonly preview: PlanNodePreview | null;
  /** The frame an agent being moved would join or stay in. */
  readonly dropTarget: string | null;
  readonly grab: (
    id: string,
    pointer: AgentPlanPosition,
  ) => PlanNodeGesture | null;
  readonly move: (gesture: PlanNodeGesture, pointer: AgentPlanPosition) => void;
  readonly finish: (
    gesture: PlanNodeGesture,
    pointer: AgentPlanPosition,
  ) => void;
  readonly cancel: (gesture: PlanNodeGesture) => void;
  readonly clear: () => void;
}

function samePosition(
  first: AgentPlanPosition | null | undefined,
  second: AgentPlanPosition,
): boolean {
  return first?.x === second.x && first.y === second.y;
}

/**
 * The position a move commits: inside a frame counted from its member area,
 * outside on the grid, both on the raster.
 */
function landingPosition(
  corner: AgentPlanPosition,
  group: AgentPlanGroup | null,
): AgentPlanPosition {
  if (!group)
    return { x: snapPlanCoordinate(corner.x), y: snapPlanCoordinate(corner.y) };
  const origin = planMemberOrigin(group);
  return {
    x: origin.x + snapPlanCoordinate(corner.x - origin.x),
    y: origin.y + snapPlanCoordinate(corner.y - origin.y),
  };
}

/**
 * Moves a node so that the point where it was grabbed stays under the pointer.
 *
 * @remarks
 * Positions are computed from the grab point, never added up from single
 * moves, so zoom and offset leave no drift. A node outside every frame moves
 * with the pointer on the raster, and its connections and members follow. A
 * member shows where it will land and changes its frame on release, by the
 * pointer alone as before. Positions stay within the limits of the server, so
 * a node stops at the edge of the plan area instead of jumping on release.
 */
export function usePlanNodeMove(options: {
  readonly draft: AgentPlanInput;
  readonly sources: AgentPlanSources;
  readonly graph: PlanGraphActions;
}): PlanNodeMove {
  const { draft, sources, graph } = options;
  const [preview, setPreview] = useState<PlanNodePreview | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  function grab(
    id: string,
    pointer: AgentPlanPosition,
  ): PlanNodeGesture | null {
    const box = planNodeBox(draft, id, sources);
    if (!box) return null;
    const found = findPlanStep(draft, id);
    return {
      kind: "node",
      id,
      grab: { x: pointer.x - box.x, y: pointer.y - box.y },
      origin: { x: box.node.x, y: box.node.y },
      isAgent: found !== null,
      memberOf: found?.group?.id ?? null,
    };
  }
  function move(gesture: PlanNodeGesture, pointer: AgentPlanPosition): void {
    const corner = {
      x: pointer.x - gesture.grab.x,
      y: pointer.y - gesture.grab.y,
    };
    const group = gesture.isAgent
      ? planDropGroup(draft, pointer, sources, gesture.memberOf)
      : null;
    if ((group?.id ?? null) !== dropTarget) setDropTarget(group?.id ?? null);
    if (gesture.memberOf === null) {
      const node = draft.nodes.find((entry) => entry.id === gesture.id);
      const next = landingPosition(corner, null);
      if (!samePosition(node, next)) graph.move(gesture.id, next.x, next.y);
      return;
    }
    const next = landingPosition(corner, group);
    if (!samePosition(preview, next)) setPreview({ id: gesture.id, ...next });
  }
  function finish(gesture: PlanNodeGesture, pointer: AgentPlanPosition): void {
    if (!gesture.isAgent) return;
    graph.place(gesture.id, {
      pointer,
      position: {
        x: pointer.x - gesture.grab.x,
        y: pointer.y - gesture.grab.y,
      },
    });
  }
  function cancel(gesture: PlanNodeGesture): void {
    if (gesture.memberOf === null)
      graph.move(gesture.id, gesture.origin.x, gesture.origin.y);
  }
  function clear(): void {
    setPreview(null);
    setDropTarget(null);
  }
  return { preview, dropTarget, grab, move, finish, cancel, clear };
}
