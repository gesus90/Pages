import { useState } from "react";

import { planGroupAdapter, planStepAdapter } from "@/definition/AgentPlanGroup";
import {
  findPlanStep,
  placePlanStep,
  ungroupPlanGroup,
} from "@/definition/AgentPlanGroupEdit";
import { removePlanNode } from "@/definition/AgentPlanGraph";

import {
  planDropGroup,
  planMemberOrigin,
  planMemberPosition,
  planNodeLabel,
} from "./plan-layout";
import { snapPlanCoordinate } from "./plan-node-factory";

import type { Dispatch, SetStateAction } from "react";
import type { AcpProviderId } from "@/definition/AgentConfiguration";
import type {
  AgentPlanInput,
  AgentPlanPosition,
  AgentPlanSources,
  AgentPlanStep,
} from "@/definition/AgentPlan";
import type {
  AgentPlanGroup,
  AgentPlanGroupRefusal,
} from "@/definition/AgentPlanGroup";
import type { PlanGroupMove } from "@/definition/AgentPlanGroupEdit";

/** What the editor tells about the last change of a group's membership. */
export type PlanGroupNotice =
  | {
      readonly kind: "refused";
      readonly refusal: AgentPlanGroupRefusal;
      readonly name: string;
      readonly adapter: AcpProviderId | null;
      readonly groupAdapter: AcpProviderId | null;
    }
  | {
      readonly kind: "moved";
      readonly removedEdges: number;
      readonly removedBindings: number;
    };

/** A node dropped on the grid: where the pointer was and where the node's corner lands. */
export interface PlanDrop {
  readonly pointer: AgentPlanPosition;
  readonly position: AgentPlanPosition;
}

/** Membership, placement and removal of frames, with what they tell the person. */
export interface PlanGroupActions {
  readonly notice: PlanGroupNotice | null;
  readonly clearNotice: () => void;
  /** A frame with members waiting for the choice between keeping and deleting them. */
  readonly removalId: string | null;
  readonly requestRemoval: (id: string) => void;
  readonly cancelRemoval: () => void;
  /** Removes a frame; `keepMembers` leaves its members on the grid where they are. */
  readonly removeGroup: (id: string, keepMembers: boolean) => void;
  /** Places a dropped agent node in the frame under the pointer, or outside every frame. */
  readonly place: (id: string, drop: PlanDrop) => void;
  /** Moves an agent node into a group's member area, or out of every frame, from a form. */
  readonly assign: (id: string, groupId: string | null) => void;
  /** Tells why a group refused an agent node. */
  readonly refuse: (
    refusal: AgentPlanGroupRefusal,
    step: AgentPlanStep,
    group: AgentPlanGroup,
  ) => void;
}

function snap(position: AgentPlanPosition): AgentPlanPosition {
  return {
    x: snapPlanCoordinate(position.x),
    y: snapPlanCoordinate(position.y),
  };
}

/** The position of a node inside a frame, counted from its member area. */
function memberOffset(
  group: AgentPlanGroup,
  position: AgentPlanPosition,
): AgentPlanPosition {
  const origin = planMemberOrigin(group);
  return snap({ x: position.x - origin.x, y: position.y - origin.y });
}

/** The next free member slot to the right of a frame's members. */
function nextSlot(group: AgentPlanGroup): AgentPlanPosition {
  const right = Math.max(0, ...group.steps.map((step) => step.x + 320));
  return { x: snapPlanCoordinate(right), y: 0 };
}

function refusalNotice(
  refusal: AgentPlanGroupRefusal,
  context: {
    readonly step: AgentPlanStep;
    readonly group: AgentPlanGroup;
    readonly sources: AgentPlanSources;
  },
): PlanGroupNotice {
  const { step, group, sources } = context;
  return {
    kind: "refused",
    refusal,
    name: planNodeLabel(step, sources),
    adapter: planStepAdapter(step, sources.agents),
    groupAdapter: planGroupAdapter(group, sources.agents),
  };
}

/** Names the connections a move dropped; a move that dropped none needs no notice. */
function moveNotice(
  result: PlanGroupMove<AgentPlanInput>,
): PlanGroupNotice | null {
  if (result.removedEdges + result.removedBindings === 0) return null;
  return {
    kind: "moved",
    removedEdges: result.removedEdges,
    removedBindings: result.removedBindings,
  };
}

/** Keeps group membership edits, their notices and the removal choice of one plan draft. */
export function usePlanGroupActions(options: {
  readonly draft: AgentPlanInput;
  readonly setDraft: Dispatch<SetStateAction<AgentPlanInput>>;
  readonly sources: AgentPlanSources;
  readonly onRemoved: (id: string) => void;
}): PlanGroupActions {
  const { draft, setDraft, sources } = options;
  const [notice, setNotice] = useState<PlanGroupNotice | null>(null);
  const [removalId, setRemovalId] = useState<string | null>(null);
  function refuse(
    refusal: AgentPlanGroupRefusal,
    step: AgentPlanStep,
    group: AgentPlanGroup,
  ): void {
    setNotice(refusalNotice(refusal, { step, group, sources }));
  }
  function apply(
    step: AgentPlanStep,
    group: AgentPlanGroup | null,
    position: AgentPlanPosition,
  ): void {
    const result = placePlanStep(
      draft,
      { stepId: step.id, groupId: group?.id ?? null, position },
      sources.agents,
    );
    if (typeof result === "string") {
      if (group) refuse(result, step, group);
      return;
    }
    setDraft(result.plan);
    report(result);
  }
  function report(result: PlanGroupMove<AgentPlanInput>): void {
    setNotice(moveNotice(result));
  }
  function place(id: string, drop: PlanDrop): void {
    const found = findPlanStep(draft, id);
    if (!found) return;
    const group = planDropGroup(
      draft,
      drop.pointer,
      sources,
      found.group?.id ?? null,
    );
    apply(
      found.step,
      group,
      group ? memberOffset(group, drop.position) : snap(drop.position),
    );
  }
  function assign(id: string, groupId: string | null): void {
    const found = findPlanStep(draft, id);
    if (!found || (found.group?.id ?? null) === groupId) return;
    const group = draft.nodes.find(
      (node): node is AgentPlanGroup =>
        node.type === "group" && node.id === groupId,
    );
    const outside = found.group
      ? planMemberPosition(found.group, found.step)
      : found.step;
    apply(
      found.step,
      group ?? null,
      group ? nextSlot(group) : snap({ x: outside.x, y: outside.y }),
    );
  }
  function removeGroup(id: string, keepMembers: boolean): void {
    setRemovalId(null);
    const group = draft.nodes.find(
      (node): node is AgentPlanGroup => node.type === "group" && node.id === id,
    );
    if (!group) return;
    if (keepMembers) {
      const result = ungroupPlanGroup(draft, id, (step) =>
        snap(planMemberPosition(group, step)),
      );
      setDraft(result.plan);
      report(result);
    } else setDraft(removePlanNode(draft, id));
    options.onRemoved(id);
  }
  return {
    notice,
    clearNotice: () => setNotice(null),
    removalId,
    requestRemoval: setRemovalId,
    cancelRemoval: () => setRemovalId(null),
    removeGroup,
    place,
    assign,
    refuse,
  };
}
