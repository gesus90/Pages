import { useState } from "react";

import { planGroupAdapter, planStepAdapter } from "@/definition/AgentPlanGroup";
import {
  findPlanStep,
  placePlanStep,
  replacePlanNode,
  ungroupPlanGroup,
} from "@/definition/AgentPlanGroupEdit";
import { removePlanNode } from "@/definition/AgentPlanGraph";
import {
  planFrameMoveNeedsRepair,
  planFrameUngroupNeedsRepair,
} from "@/definition/AgentPlanFrameSafety";
import {
  findPlanNodeLocation,
  placePlanLoopNode,
  ungroupPlanLoop,
} from "@/definition/AgentPlanLoopEdit";
import {
  findPlanGroupLocation,
  placePlanGroupInLoop,
  ungroupPlanLoopGroup,
} from "@/definition/AgentPlanLoopGroupEdit";
import { joinPlanStack } from "@/definition/AgentPlanStackEdit";

import {
  PLAN_FRAME_PADDING,
  planGroupHeaderHeight,
  planDropGroup,
  planMemberOrigin,
  planMemberPosition,
  planNodeLabel,
} from "./plan-layout";
import { boundedPlanCoordinate } from "./plan-node-factory";
import { placePlanDecisionDrop } from "./plan-decision-placement";

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
import type { AgentPlanLoop } from "@/definition/AgentPlanLoop";
import type { PlanGroupPlacement } from "@/definition/AgentPlanLoopGroupEdit";
import type {
  PlanNodeLocation,
  PlanNodePlacement,
} from "@/definition/AgentPlanLoopEdit";
import type { PlanFrame } from "./plan-layout";

/** What the editor tells about the last change of a group's membership. */
export type PlanGroupNotice =
  | { readonly kind: "repair"; readonly name: string }
  | {
      readonly kind: "refused";
      readonly refusal: AgentPlanGroupRefusal;
      readonly name: string;
      readonly adapter: AcpProviderId | null;
      readonly groupAdapter: AcpProviderId | null;
    }
  | {
      readonly kind: "moved";
      readonly frame: "group" | "loop" | "stack";
      readonly removedEdges: number;
      readonly removedBindings: number;
    };

/** A node dropped on the grid: where the pointer was and where the node's corner lands. */
export interface PlanDrop {
  readonly pointer: AgentPlanPosition;
  readonly excludedGroups?: ReadonlySet<string>;
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
  /** Moves a whole group into the loop under the pointer, within it, or onto the outer grid. */
  readonly placeGroup: (id: string, drop: PlanDrop) => void;
  /** Moves a ticket or value node of the grid into a stack as its last entry. */
  readonly joinStack: (id: string, stackId: string) => void;
  /** Moves an agent node into a group's member area, or out of every frame, from a form. */
  readonly assign: (id: string, groupId: string | null) => void;
  /** Tells why a group refused an agent node. */
  readonly refuse: (
    refusal: AgentPlanGroupRefusal,
    step: AgentPlanStep,
    group: AgentPlanGroup,
  ) => void;
}

function boundedPosition(position: AgentPlanPosition): AgentPlanPosition {
  return {
    x: boundedPlanCoordinate(position.x),
    y: boundedPlanCoordinate(position.y),
  };
}

/** The position of a node inside a frame, counted from its member area. */
function memberOffset(
  group: PlanFrame,
  position: AgentPlanPosition,
): AgentPlanPosition {
  const origin = planMemberOrigin(group);
  return boundedPosition({
    x: position.x - origin.x,
    y: position.y - origin.y,
  });
}

/** The top left corner of the member area of a group inside a loop, on the grid. */
function nestedMemberOrigin(
  loop: AgentPlanLoop,
  group: AgentPlanGroup,
): AgentPlanPosition {
  const corner = planMemberOrigin(loop);
  const inner = planMemberOrigin({ ...group, x: 0, y: 0 });
  return { x: corner.x + group.x + inner.x, y: corner.y + group.y + inner.y };
}

/** Moves a dropped agent of a group inside a loop within its group; `false` for any other node. */
function placeNestedMember(
  context: Pick<FrameMoveContext, "setDraft" | "setNotice">,
  found: PlanNodeLocation,
  drop: PlanDrop,
): boolean {
  if (!found.loop || !found.group) return false;
  const origin = nestedMemberOrigin(found.loop, found.group);
  const id = found.node.id;
  context.setDraft((previous) =>
    moveNestedMember(previous, id, { origin, drop }),
  );
  context.setNotice(null);
  return true;
}

/** Moves an agent of a group inside a loop to the drop, counted from its group's member area. */
function moveNestedMember(
  draft: AgentPlanInput,
  id: string,
  target: { readonly origin: AgentPlanPosition; readonly drop: PlanDrop },
): AgentPlanInput {
  const current = findPlanNodeLocation(draft, id);
  if (!current) return draft;
  const { origin, drop } = target;
  return replacePlanNode(draft, {
    ...current.node,
    ...boundedPosition({
      x: drop.position.x - origin.x,
      y: drop.position.y - origin.y,
    }),
  });
}

/** Moves a node within its current frame without replacing concurrent draft edits. */
function moveWithinFrame(
  draft: AgentPlanInput,
  target: {
    readonly id: string;
    readonly frameId: string | null;
    readonly position: AgentPlanPosition;
  },
): AgentPlanInput {
  const found = findPlanNodeLocation(draft, target.id);
  if (!found) return draft;
  const frame = found.group ?? found.loop ?? null;
  if ((frame?.id ?? null) !== target.frameId) return draft;
  const position = frame
    ? memberOffset(frame, target.position)
    : boundedPosition(target.position);
  return replacePlanNode(draft, { ...found.node, ...position });
}

/** The next free member slot to the right of a frame's members. */
function nextSlot(group: AgentPlanGroup): AgentPlanPosition {
  const right = Math.max(0, ...group.steps.map((step) => step.x + 320));
  return { x: boundedPlanCoordinate(right), y: 0 };
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
  result: Pick<
    PlanGroupMove<AgentPlanInput>,
    "removedEdges" | "removedBindings"
  >,
  frame: "group" | "loop" | "stack",
): PlanGroupNotice | null {
  if (result.removedEdges + result.removedBindings === 0) return null;
  return {
    kind: "moved",
    frame,
    removedEdges: result.removedEdges,
    removedBindings: result.removedBindings,
  };
}

/** Moves an agent or script into a loop or out of it; a group frees an agent first. */
function moveToLoop(
  draft: AgentPlanInput,
  sources: AgentPlanSources,
  placement: PlanNodePlacement,
): ReturnType<typeof placePlanLoopNode<AgentPlanInput>> {
  return placePlanLoopNode(draft, placement, {
    agents: sources.agents,
    detachFromGroup: (plan, step, at) => {
      const moved = placePlanStep(
        plan,
        { stepId: step.id, groupId: null, position: at },
        sources.agents,
      );
      return typeof moved === "string" ? moved : moved.plan;
    },
  });
}

/** The frame under the pointer of a drop, ignoring frames the canvas shows collapsed. */
function dropFrame(
  draft: AgentPlanInput,
  sources: AgentPlanSources,
  target: { readonly found: PlanNodeLocation; readonly drop: PlanDrop },
): PlanFrame | null {
  const { found, drop } = target;
  const frame = planDropGroup(
    {
      ...draft,
      nodes: draft.nodes.filter((node) => !drop.excludedGroups?.has(node.id)),
    },
    drop.pointer,
    sources,
    found.group?.id ?? found.loop?.id ?? null,
  );
  // A script joins loops only, so a group under it is no frame for it.
  return found.node.type === "script" && frame?.type === "group" ? null : frame;
}

/** The plan without a group, with or without its members; `null` when the group is gone. */
function groupRemoval(
  draft: AgentPlanInput,
  id: string,
  keepMembers: boolean,
): PlanGroupMove<AgentPlanInput> | null {
  const nested = findPlanGroupLocation(draft, id);
  if (nested?.loop) {
    return {
      plan: keepMembers
        ? ungroupPlanLoopGroup(draft, id, (step, group) => ({
            x: boundedPlanCoordinate(group.x + PLAN_FRAME_PADDING + step.x),
            y: boundedPlanCoordinate(
              group.y + planGroupHeaderHeight(group) + step.y,
            ),
          }))
        : removePlanNode(draft, id),
      removedEdges: 0,
      removedBindings: 0,
    };
  }
  const group = draft.nodes.find(
    (node): node is PlanFrame =>
      (node.type === "group" || node.type === "loop") && node.id === id,
  );
  if (!group) return null;
  if (!keepMembers)
    return {
      plan: removePlanNode(draft, id),
      removedEdges: 0,
      removedBindings: 0,
    };
  if (group.type === "loop")
    return ungroupPlanLoop(draft, id, (member) =>
      boundedPosition(planMemberPosition(group, member)),
    );
  return ungroupPlanGroup(draft, id, (step) =>
    boundedPosition(planMemberPosition(group, step)),
  );
}

/** Whether a frame of the plan is a loop; every other frame is a group. */
function frameKind(draft: AgentPlanInput, id: string): "group" | "loop" {
  return draft.nodes.some((node) => node.id === id && node.type === "loop")
    ? "loop"
    : "group";
}

/** Whether a drop leaves a member in its existing frame. */
function sameFrame(found: PlanNodeLocation, frame: PlanFrame | null): boolean {
  return (found.group?.id ?? found.loop?.id ?? null) === (frame?.id ?? null);
}

/** Builds the placement of a dropped node inside or outside a loop. */
function loopPlacement(
  found: PlanNodeLocation,
  frame: PlanFrame | null,
  drop: PlanDrop,
): PlanNodePlacement {
  const loop = frame?.type === "loop" ? frame : null;
  return {
    nodeId: found.node.id,
    loopId: loop?.id ?? null,
    position: loop
      ? memberOffset(loop, drop.position)
      : boundedPosition(drop.position),
  };
}

/** Applies a drop while keeping changes queued to the same frame. */
function placeDrop(
  context: {
    readonly draft: AgentPlanInput;
    readonly setDraft: Dispatch<SetStateAction<AgentPlanInput>>;
    readonly sources: AgentPlanSources;
    readonly setNotice: Dispatch<SetStateAction<PlanGroupNotice | null>>;
    readonly apply: (
      step: AgentPlanStep,
      group: AgentPlanGroup | null,
      position: AgentPlanPosition,
    ) => void;
  },
  id: string,
  drop: PlanDrop,
): void {
  const { draft, setDraft, sources, setNotice, apply } = context;
  const found = findPlanNodeLocation(draft, id);
  if (!found) return;
  // An agent of a group inside a loop moves within its group only; the group moves as a whole.
  if (placeNestedMember(context, found, drop)) return;
  const frame = dropFrame(draft, sources, { found, drop });
  if (sameFrame(found, frame)) {
    setDraft((previous) =>
      moveWithinFrame(previous, {
        id,
        frameId: frame?.id ?? null,
        position: drop.position,
      }),
    );
    setNotice(null);
    return;
  }
  if (found.loop || frame?.type === "loop" || found.node.type === "script") {
    const result = moveToLoop(
      draft,
      sources,
      loopPlacement(found, frame, drop),
    );
    if (typeof result === "string") return;
    if (planFrameMoveNeedsRepair(draft, id, frame?.id ?? null, result)) {
      setNotice({ kind: "repair", name: planNodeLabel(found.node, sources) });
      return;
    }
    setDraft((previous) => {
      const current = findPlanNodeLocation(previous, id);
      if (!current) return previous;
      const target = dropFrame(previous, sources, { found: current, drop });
      if ((target?.id ?? null) !== (frame?.id ?? null)) return previous;
      const moved = moveToLoop(
        previous,
        sources,
        loopPlacement(current, target, drop),
      );
      return typeof moved === "string" ||
        planFrameMoveNeedsRepair(previous, id, target?.id ?? null, moved)
        ? previous
        : moved.plan;
    });
    setNotice(moveNotice(result, "loop"));
    return;
  }
  const group = frame?.type === "group" ? frame : null;
  apply(
    found.node,
    group,
    group ? memberOffset(group, drop.position) : boundedPosition(drop.position),
  );
}

function removeFrame(
  context: {
    readonly draft: AgentPlanInput;
    readonly setDraft: Dispatch<SetStateAction<AgentPlanInput>>;
    readonly setNotice: Dispatch<SetStateAction<PlanGroupNotice | null>>;
    readonly setRemovalId: Dispatch<SetStateAction<string | null>>;
    readonly onRemoved: (id: string) => void;
  },
  id: string,
  keepMembers: boolean,
): void {
  const { draft, setDraft, setNotice, setRemovalId, onRemoved } = context;
  setRemovalId(null);
  if (keepMembers && planFrameUngroupNeedsRepair(draft, id)) {
    const frame = draft.nodes.find((node) => node.id === id);
    if (frame && (frame.type === "group" || frame.type === "loop"))
      setNotice({ kind: "repair", name: frame.name });
    return;
  }
  const result = groupRemoval(draft, id, keepMembers);
  if (!result) return;
  setDraft((previous) =>
    keepMembers && planFrameUngroupNeedsRepair(previous, id)
      ? previous
      : (groupRemoval(previous, id, keepMembers)?.plan ?? previous),
  );
  if (keepMembers) setNotice(moveNotice(result, frameKind(draft, id)));
  onRemoved(id);
}

function applyGroupPlacement(
  context: {
    readonly draft: AgentPlanInput;
    readonly setDraft: Dispatch<SetStateAction<AgentPlanInput>>;
    readonly sources: AgentPlanSources;
    readonly setNotice: Dispatch<SetStateAction<PlanGroupNotice | null>>;
  },
  step: AgentPlanStep,
  group: AgentPlanGroup | null,
  position: AgentPlanPosition,
): void {
  const { draft, setDraft, sources, setNotice } = context;
  const target = { stepId: step.id, groupId: group?.id ?? null, position };
  const result = placePlanStep(draft, target, sources.agents);
  if (typeof result === "string") {
    if (group) setNotice(refusalNotice(result, { step, group, sources }));
    return;
  }
  if (planFrameMoveNeedsRepair(draft, step.id, target.groupId, result)) {
    setNotice({ kind: "repair", name: planNodeLabel(step, sources) });
    return;
  }
  setDraft((previous) => {
    const moved = placePlanStep(previous, target, sources.agents);
    return typeof moved === "string" ||
      planFrameMoveNeedsRepair(previous, step.id, target.groupId, moved)
      ? previous
      : moved.plan;
  });
  setNotice(moveNotice(result, "group"));
}

/** What a move of a whole group or a stack entry needs from the hook. */
interface FrameMoveContext {
  readonly draft: AgentPlanInput;
  readonly setDraft: Dispatch<SetStateAction<AgentPlanInput>>;
  readonly sources: AgentPlanSources;
  readonly setNotice: Dispatch<SetStateAction<PlanGroupNotice | null>>;
}

/** Moves a whole group into the loop under the pointer, within it, or onto the outer grid. */
function placeGroupDrop(
  context: FrameMoveContext,
  id: string,
  drop: PlanDrop,
): void {
  const { draft, setDraft, sources, setNotice } = context;
  const placement = groupPlacement(draft, sources, { id, drop });
  if (!placement) return;
  const result = placePlanGroupInLoop(draft, placement);
  if (typeof result === "string") return;
  setDraft((previous) => {
    const next = groupPlacement(previous, sources, { id, drop });
    const moved = next ? placePlanGroupInLoop(previous, next) : null;
    return moved && typeof moved !== "string" ? moved.plan : previous;
  });
  setNotice(moveNotice(result, "loop"));
}

/** Moves a ticket or value node into a stack as its last entry. */
function joinStackDrop(
  context: FrameMoveContext,
  id: string,
  stackId: string,
): void {
  const result = joinPlanStack(context.draft, stackId, id);
  if (typeof result === "string") return;
  context.setDraft((previous) => {
    const joined = joinPlanStack(previous, stackId, id);
    return typeof joined === "string" ? previous : joined.plan;
  });
  context.setNotice(moveNotice({ ...result, removedEdges: 0 }, "stack"));
}

/**
 * Where a dropped group goes: the loop under the pointer, or the outer grid.
 *
 * @returns `null` for a group that is gone.
 */
function groupPlacement(
  draft: AgentPlanInput,
  sources: AgentPlanSources,
  target: { readonly id: string; readonly drop: PlanDrop },
): PlanGroupPlacement | null {
  const found = findPlanGroupLocation(draft, target.id);
  if (!found) return null;
  const frame = planDropGroup(
    {
      ...draft,
      nodes: draft.nodes.filter(
        (node) =>
          node.id !== target.id && !target.drop.excludedGroups?.has(node.id),
      ),
    },
    target.drop.pointer,
    sources,
    found.loop?.id ?? null,
  );
  const loop = frame?.type === "loop" ? frame : null;
  return {
    groupId: target.id,
    loopId: loop?.id ?? null,
    position: loop
      ? memberOffset(loop, target.drop.position)
      : boundedPosition(target.drop.position),
  };
}

/** Keeps group membership edits, their notices and the removal choice of one plan draft. */
export function usePlanGroupActions(options: {
  readonly draft: AgentPlanInput;
  readonly setDraft: Dispatch<SetStateAction<AgentPlanInput>>;
  readonly sources: AgentPlanSources;
  readonly currentDraft?: () => AgentPlanInput;
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
    applyGroupPlacement(
      {
        draft: options.currentDraft?.() ?? draft,
        setDraft,
        sources,
        setNotice,
      },
      step,
      group,
      position,
    );
  }
  function assign(id: string, groupId: string | null): void {
    const current = options.currentDraft?.() ?? draft;
    const found = findPlanStep(current, id);
    if (!found || (found.group?.id ?? null) === groupId) return;
    const group = current.nodes.find(
      (node): node is AgentPlanGroup =>
        node.type === "group" && node.id === groupId,
    );
    if (groupId !== null && !group) return;
    const outside = found.group
      ? planMemberPosition(found.group, found.step)
      : found.step;
    apply(
      found.step,
      group ?? null,
      group ? nextSlot(group) : boundedPosition({ x: outside.x, y: outside.y }),
    );
  }
  const moves = (): FrameMoveContext => ({
    draft: options.currentDraft?.() ?? draft,
    setDraft,
    sources,
    setNotice,
  });
  return {
    notice,
    clearNotice: () => setNotice(null),
    placeGroup: (id, drop) => placeGroupDrop(moves(), id, drop),
    joinStack: (id, stackId) => joinStackDrop(moves(), id, stackId),
    removalId,
    requestRemoval: setRemovalId,
    cancelRemoval: () => setRemovalId(null),
    removeGroup: (id, keepMembers) =>
      removeFrame(
        {
          draft: options.currentDraft?.() ?? draft,
          setDraft,
          setNotice,
          setRemovalId,
          onRemoved: options.onRemoved,
        },
        id,
        keepMembers,
      ),
    place: (id, drop) =>
      placePlanDecisionDrop(moves(), id, drop) ||
      placeDrop(
        {
          draft: options.currentDraft?.() ?? draft,
          setDraft,
          sources,
          setNotice,
          apply,
        },
        id,
        drop,
      ),
    assign,
    refuse,
  };
}
