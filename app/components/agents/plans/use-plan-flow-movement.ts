import { useReactFlow } from "@xyflow/react";
import { useEffect, useRef, useState } from "react";

import {
  PLAN_FRAME_PADDING,
  planGroupHeaderHeight,
  planDropGroup,
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
import type { PlanGraphActions } from "./use-plan-graph";
import type { Dispatch, RefObject, SetStateAction } from "react";

interface MovementOptions {
  readonly draft: AgentPlanInput;
  readonly sources: AgentPlanSources;
  readonly graph: PlanGraphActions;
  readonly canEdit: boolean;
  readonly collapsedGroups: ReadonlySet<string>;
}

function memberGroup(
  plan: AgentPlanInput,
  node: PlanFlowNode,
): AgentPlanInput["nodes"][number] | undefined {
  return plan.nodes.find((entry) => entry.id === node.parentId);
}

function storedPosition(plan: AgentPlanInput, node: PlanFlowNode): XYPosition {
  const group = memberGroup(plan, node);
  if (group?.type !== "group" && group?.type !== "loop") return node.position;
  return {
    x: node.position.x - PLAN_FRAME_PADDING,
    y: node.position.y - planGroupHeaderHeight(),
  };
}

function absolutePosition(
  plan: AgentPlanInput,
  node: PlanFlowNode,
): XYPosition {
  const group = memberGroup(plan, node);
  if (group?.type !== "group" && group?.type !== "loop") return node.position;
  return { x: group.x + node.position.x, y: group.y + node.position.y };
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

/** Agents and scripts can join a loop; only agents can join a group. */
function isPlaceable(type: AgentPlanInput["nodes"][number]["type"]): boolean {
  return type === "agent" || type === "script";
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
      if (isPlaceable(node.data.node.type))
        graph.place(node.id, {
          position,
          excludedGroups: options.collapsedGroups,
          pointer: pointer ? flow.screenToFlowPosition(pointer) : position,
        });
      else graph.move(node.id, position.x, position.y);
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
    if (
      !canEdit ||
      dragState.current === "cancelled" ||
      !pointer ||
      !isPlaceable(node.data.node.type)
    )
      return;
    const group = planDropGroup(
      draft,
      flow.screenToFlowPosition(pointer),
      options.sources,
      node.parentId ?? null,
    );
    setDropTarget(
      group && !options.collapsedGroups.has(group.id) ? group.id : null,
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
