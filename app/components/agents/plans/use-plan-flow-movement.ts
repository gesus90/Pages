import { useReactFlow } from "@xyflow/react";
import { useEffect, useRef, useState } from "react";

import { findPlanGroupLocation } from "@/definition/AgentPlanLoopGroupEdit";

import {
  PLAN_FRAME_PADDING,
  planDropGroup,
  planDropStack,
  planGroupHeaderHeight,
  planMemberOrigin,
} from "./plan-layout";
import { planFlowNodes } from "./plan-flow-model";
import { usePlanFlowMeasurements } from "./use-plan-flow-measurements";

import type {
  Dimensions,
  NodeChange,
  OnNodeDrag,
  XYPosition,
} from "@xyflow/react";
import type { AgentPlanInput, AgentPlanSources } from "@/definition/AgentPlan";
import type { PlanFlowNode } from "./plan-flow-model";
import type { PlanFrame } from "./plan-layout";
import type { PlanGraphActions } from "./use-plan-graph";
import type { Dispatch, RefObject, SetStateAction } from "react";

interface MovementOptions {
  readonly draft: AgentPlanInput;
  readonly sources: AgentPlanSources;
  readonly graph: PlanGraphActions;
  readonly canEdit: boolean;
  readonly collapsedGroups: ReadonlySet<string>;
}

/** The frame a card lies in, a group inside a loop included. */
function memberGroup(
  plan: AgentPlanInput,
  node: PlanFlowNode,
): PlanFrame | null {
  if (!node.parentId) return null;
  const top = plan.nodes.find((entry) => entry.id === node.parentId);
  if (top?.type === "group" || top?.type === "loop") return top;
  return findPlanGroupLocation(plan, node.parentId)?.group ?? null;
}

/** The top left corner of a frame on the grid; a group inside a loop counts from the loop's member area. */
function frameCorner(plan: AgentPlanInput, frame: PlanFrame): XYPosition {
  const loop = findPlanGroupLocation(plan, frame.id)?.loop;
  if (!loop) return { x: frame.x, y: frame.y };
  const origin = planMemberOrigin(loop);
  return { x: origin.x + frame.x, y: origin.y + frame.y };
}

function storedPosition(plan: AgentPlanInput, node: PlanFlowNode): XYPosition {
  const group = memberGroup(plan, node);
  if (!group) return node.position;
  return {
    x: node.position.x - PLAN_FRAME_PADDING,
    y: node.position.y - planGroupHeaderHeight(group),
  };
}

function absolutePosition(
  plan: AgentPlanInput,
  node: PlanFlowNode,
): XYPosition {
  const group = memberGroup(plan, node);
  if (!group) return node.position;
  const corner = frameCorner(plan, group);
  return { x: corner.x + node.position.x, y: corner.y + node.position.y };
}

function clientPoint(event: MouseEvent | TouchEvent): XYPosition | null {
  if ("clientX" in event) return { x: event.clientX, y: event.clientY };
  const touch = event.changedTouches[0];
  return touch ? { x: touch.clientX, y: touch.clientY } : null;
}

function movementNodes(
  options: MovementOptions,
  positions: Readonly<Record<string, XYPosition>>,
  measurements: Readonly<Record<string, Dimensions>>,
): PlanFlowNode[] {
  return planFlowNodes(options.draft, {
    ...options,
    selectedId: options.graph.selectedId,
  }).map((node) => ({
    ...node,
    // Omitting measured resets every handle bound when React Flow adopts these nodes.
    measured: measurements[node.id],
    position: positions[node.id] ?? node.position,
  }));
}

/** Agents and scripts can join a loop; only agents can join a group; a decision can join both. */
function isPlaceable(type: AgentPlanInput["nodes"][number]["type"]): boolean {
  return type === "agent" || type === "script" || type === "decision";
}

/** Tickets and values can join a stack as entries. */
function isStackEntry(type: AgentPlanInput["nodes"][number]["type"]): boolean {
  return type === "task" || type === "parameter";
}

/** What a dragged card would land in under the pointer: a frame, a loop for a group, or a stack. */
function dropTargetOf(
  options: MovementOptions,
  node: PlanFlowNode,
  point: XYPosition,
): string | null {
  const type = node.data.node.type;
  if (isStackEntry(type) && !node.parentId)
    return planDropStack(options.draft, point)?.id ?? null;
  if (type === "group") {
    const frame = planDropGroup(
      {
        ...options.draft,
        nodes: options.draft.nodes.filter((entry) => entry.id !== node.id),
      },
      point,
      options.sources,
      node.parentId ?? null,
    );
    return frame?.type === "loop" ? frame.id : null;
  }
  if (!isPlaceable(type)) return null;
  const group = planDropGroup(
    options.draft,
    point,
    options.sources,
    node.parentId ?? null,
  );
  return group && !options.collapsedGroups.has(group.id) ? group.id : null;
}

/** Finishes a drag: a member is placed, a group may enter a loop, a ticket or value may join a stack. */
function dropNode(
  options: MovementOptions,
  node: PlanFlowNode,
  drop: { readonly position: XYPosition; readonly pointer: XYPosition },
): void {
  const { graph } = options;
  const type = node.data.node.type;
  const target = {
    position: drop.position,
    excludedGroups: options.collapsedGroups,
    pointer: drop.pointer,
  };
  if (isPlaceable(type)) {
    graph.place(node.id, target);
    return;
  }
  if (type === "group") {
    graph.placeGroup(node.id, target);
    return;
  }
  const stack = isStackEntry(type)
    ? planDropStack(options.draft, drop.pointer)
    : null;
  if (stack) graph.joinStack(node.id, stack.id);
  else graph.move(node.id, drop.position.x, drop.position.y);
}

interface FlowMovementActions {
  readonly nodes: PlanFlowNode[];
  readonly onNodesChange: (changes: NodeChange<PlanFlowNode>[]) => void;
  readonly onNodeDragStart: OnNodeDrag<PlanFlowNode>;
  readonly onNodeDrag: OnNodeDrag<PlanFlowNode>;
  readonly onNodeDragStop: OnNodeDrag<PlanFlowNode>;
  readonly dropTarget: string | null;
  readonly cancel: () => void;
}

interface NodeChangesContext {
  readonly draft: AgentPlanInput;
  readonly nodes: readonly PlanFlowNode[];
  readonly graph: PlanGraphActions;
  readonly canEdit: boolean;
  readonly dragState: RefObject<"idle" | "dragging" | "cancelled">;
  readonly measure: ReturnType<typeof usePlanFlowMeasurements>["measure"];
  readonly setPositions: Dispatch<
    SetStateAction<Readonly<Record<string, XYPosition>>>
  >;
}

/** Records visual movement and its saveable coordinate without changing frame membership. */
function applyNodeChanges(
  context: NodeChangesContext,
  changes: NodeChange<PlanFlowNode>[],
): void {
  const { draft, nodes, graph, canEdit, dragState, measure, setPositions } =
    context;
  measure(changes);
  for (const change of changes) {
    if (change.type === "select" && change.selected) graph.select(change.id);
    if (
      change.type !== "position" ||
      !change.position ||
      !canEdit ||
      dragState.current === "cancelled"
    )
      continue;
    const node = nodes.find((entry) => entry.id === change.id);
    if (!node) continue;
    const position = storedPosition(draft, {
      ...node,
      position: change.position,
    });
    if (dragState.current === "dragging" || change.dragging === true) {
      graph.registerPendingMove({ id: node.id, x: position.x, y: position.y });
      const visual = change.position;
      setPositions((previous) => ({ ...previous, [change.id]: visual }));
    } else graph.move(node.id, position.x, position.y);
  }
}

/** React Flow owns dragging; a finished move or explicit save updates the Pages draft. */
export function usePlanFlowMovement(
  options: MovementOptions,
): FlowMovementActions {
  const { draft, graph, canEdit } = options;
  const { registerPendingMove } = graph;
  const flow = useReactFlow<PlanFlowNode>();
  const { measurements, measure } = usePlanFlowMeasurements();
  const [positions, setPositions] = useState<
    Readonly<Record<string, XYPosition>>
  >({});
  const dragState = useRef<"idle" | "dragging" | "cancelled">("idle");
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  useEffect(() => {
    // A changed permission discards an unfinished visual move.
    dragState.current = "idle";
    registerPendingMove(null);
    setPositions((previous) =>
      Object.keys(previous).length === 0 ? previous : {},
    );
    setDropTarget(null);
    return () => registerPendingMove(null);
  }, [canEdit, registerPendingMove]);
  const nodes = movementNodes(options, positions, measurements);
  const onNodeDragStop: OnNodeDrag<PlanFlowNode> = (event, node) => {
    registerPendingMove(null);
    if (canEdit && dragState.current !== "cancelled") {
      const position = absolutePosition(draft, node);
      const pointer = clientPoint(event);
      dropNode(options, node, {
        position,
        pointer: pointer ? flow.screenToFlowPosition(pointer) : position,
      });
    }
    setPositions({});
    setDropTarget(null);
    dragState.current = "idle";
  };
  function cancel(): void {
    if (dragState.current !== "idle") dragState.current = "cancelled";
    registerPendingMove(null);
    setPositions({});
    setDropTarget(null);
  }
  const onNodeDrag: OnNodeDrag<PlanFlowNode> = (event, node) => {
    const pointer = clientPoint(event);
    if (!canEdit || dragState.current === "cancelled" || !pointer) return;
    setDropTarget(
      dropTargetOf(options, node, flow.screenToFlowPosition(pointer)),
    );
  };
  return {
    nodes,
    onNodesChange: (changes) =>
      applyNodeChanges(
        { draft, nodes, graph, canEdit, dragState, measure, setPositions },
        changes,
      ),
    onNodeDragStart: (...drag) => {
      const node = drag[1];
      dragState.current = "dragging";
      const position = storedPosition(draft, node);
      registerPendingMove({ id: node.id, x: position.x, y: position.y });
    },
    onNodeDrag,
    onNodeDragStop,
    dropTarget,
    cancel,
  };
}
