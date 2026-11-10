import {
  findPlanDecision,
  placePlanDecision,
} from "@/definition/AgentPlanDecisionEdit";

import { planDropGroup, planMemberOrigin, planNodeLabel } from "./plan-layout";
import { boundedPlanCoordinate } from "./plan-node-factory";

import type { Dispatch, SetStateAction } from "react";
import type {
  AgentPlanInput,
  AgentPlanPosition,
  AgentPlanSources,
} from "@/definition/AgentPlan";
import type { PlanDecisionPlace } from "@/definition/AgentPlanDecisionEdit";
import type { PlanDrop, PlanGroupNotice } from "./use-plan-group-actions";

/** The frame a decision stands in, or `null` at the top level. */
function frameOf(place: PlanDecisionPlace): string | null {
  if (place.kind === "group") return place.groupId;
  return place.kind === "loop" ? place.loopId : null;
}

/** Where a dropped decision lands: the frame under the pointer, if one admits it, and its stored position. */
function decisionTarget(
  draft: AgentPlanInput,
  sources: AgentPlanSources,
  move: { readonly current: string | null; readonly drop: PlanDrop },
): { readonly frameId: string | null; readonly position: AgentPlanPosition } {
  const { drop } = move;
  const frame = planDropGroup(draft, drop.pointer, sources, move.current);
  const isOpen = frame !== null && !drop.excludedGroups?.has(frame.id);
  const origin = isOpen ? planMemberOrigin(frame) : { x: 0, y: 0 };
  return {
    frameId: isOpen ? frame.id : null,
    position: {
      x: boundedPlanCoordinate(drop.position.x - origin.x),
      y: boundedPlanCoordinate(drop.position.y - origin.y),
    },
  };
}

/**
 * Places a dropped decision in the frame under the pointer, or outside every frame (PAGE-286).
 *
 * @returns Whether the node was a decision; any other node is placed as before.
 *
 * @remarks
 * A move that would cut a condition or branch connection, which joins nodes
 * of one container only, is refused with the repair notice, as for agents.
 */
export function placePlanDecisionDrop(
  context: {
    readonly draft: AgentPlanInput;
    readonly setDraft: Dispatch<SetStateAction<AgentPlanInput>>;
    readonly sources: AgentPlanSources;
    readonly setNotice: Dispatch<SetStateAction<PlanGroupNotice | null>>;
  },
  id: string,
  drop: PlanDrop,
): boolean {
  const { draft, sources } = context;
  const found = findPlanDecision(draft, id);
  if (!found) return false;
  const target = decisionTarget(draft, sources, {
    current: frameOf(found.place),
    drop,
  });
  const moved = placePlanDecision(draft, {
    decisionId: id,
    ...target,
  });
  if (!moved) return true;
  if (moved.removedEdges > 0) {
    context.setNotice({
      kind: "repair",
      name: planNodeLabel(found.decision, sources),
    });
    return true;
  }
  context.setDraft(
    (previous) =>
      placePlanDecision(previous, { decisionId: id, ...target })?.plan ??
      previous,
  );
  context.setNotice(null);
  return true;
}
