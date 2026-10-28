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
  planDropGroup,
  planMemberOrigin,
  planMemberPosition,
  planNodeLabel,
} from "./plan-layout";
import { boundedPlanCoordinate } from "./plan-node-factory";

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
      readonly frame: "group" | "loop";
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
  result: PlanGroupMove<AgentPlanInput>,
  frame: "group" | "loop",
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
  return planDropGroup(
    {
      ...draft,
      nodes: draft.nodes.filter((node) => !drop.excludedGroups?.has(node.id)),
    },
    drop.pointer,
    sources,
    found.group?.id ?? found.loop?.id ?? null,
  );
}

/** The plan without a group, with or without its members; `null` when the group is gone. */
function groupRemoval(
  draft: AgentPlanInput,
  id: string,
  keepMembers: boolean,
): PlanGroupMove<AgentPlanInput> | null {
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
  return {
    notice,
    clearNotice: () => setNotice(null),
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
