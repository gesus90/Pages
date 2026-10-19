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
  if (group?.type !== "group") return node.position;
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
  if (group?.type !== "group") return node.position;
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

interface FlowMovementActions {
  readonly nodes: PlanFlowNode[];
  readonly onNodesChange: (changes: NodeChange<PlanFlowNode>[]) => void;
  readonly onNodeDragStart: OnNodeDrag<PlanFlowNode>;
  readonly onNodeDrag: OnNodeDrag<PlanFlowNode>;
  readonly onNodeDragStop: OnNodeDrag<PlanFlowNode>;
  readonly dropTarget: string | null;
  readonly cancel: () => void;
}

/** React Flow owns dragging; only a finished move updates the Pages draft. */
export function usePlanFlowMovement(
  options: MovementOptions,
): FlowMovementActions {
  const { draft, graph, canEdit } = options;
  const flow = useReactFlow<PlanFlowNode>();
  const { measurements, measure } = usePlanFlowMeasurements();
  const [positions, setPositions] = useState<
    Readonly<Record<string, XYPosition>>
  >({});
  const dragState = useRef<"idle" | "dragging" | "cancelled">("idle");
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  useEffect(() => {
    // A save or lost edit permission must discard any unfinished visual move.
    dragState.current = "idle";
    setPositions((previous) =>
      Object.keys(previous).length === 0 ? previous : {},
    );
    setDropTarget(null);
  }, [canEdit]);
  const nodes = movementNodes(options, positions, measurements);
  function onNodesChange(changes: NodeChange<PlanFlowNode>[]): void {
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
      if (dragState.current === "dragging" || change.dragging === true) {
        const position = change.position;
        setPositions((previous) => ({ ...previous, [change.id]: position }));
        continue;
      }
      const node = nodes.find((entry) => entry.id === change.id);
      if (!node) continue;
      const position = storedPosition(draft, {
        ...node,
        position: change.position,
      });
      graph.move(node.id, position.x, position.y);
    }
  }
  const onNodeDragStop: OnNodeDrag<PlanFlowNode> = (event, node) => {
    if (canEdit && dragState.current !== "cancelled") {
      const position = absolutePosition(draft, node);
      const pointer = clientPoint(event);
      if (node.data.node.type === "agent")
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
    setPositions({});
    setDropTarget(null);
  }
  const onNodeDrag: OnNodeDrag<PlanFlowNode> = (event, node) => {
    const pointer = clientPoint(event);
    if (
      !canEdit ||
      dragState.current === "cancelled" ||
      !pointer ||
      node.data.node.type !== "agent"
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
    onNodesChange,
    onNodeDragStart: () => {
      dragState.current = "dragging";
    },
    onNodeDrag,
    onNodeDragStop,
    dropTarget,
    cancel,
  };
}
