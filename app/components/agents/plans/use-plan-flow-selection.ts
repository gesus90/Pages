import { planLinkKey, planLinks } from "./plan-links";

import type { ReactFlowProps } from "@xyflow/react";
import type { PlanCanvasProps } from "./plan-flow-context";
import type { PlanFlowEdge, PlanFlowNode } from "./plan-flow-model";

/** Keyboard, pointer and inspector selection share one domain selection, including read-only plans. */
export function usePlanFlowSelection(
  props: PlanCanvasProps,
): Pick<
  ReactFlowProps<PlanFlowNode, PlanFlowEdge>,
  | "onNodeClick"
  | "onNodeDoubleClick"
  | "onEdgeClick"
  | "onEdgesChange"
  | "onPaneClick"
> {
  const { graph } = props;
  return {
    onNodeClick: (event, node) => graph.select(node.id),
    onNodeDoubleClick: (event, node) => {
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest(
          "button, input, textarea, select, a, .react-flow__handle",
        ) &&
        !target.closest("[data-plan-handle]")
      )
        return;
      graph.select(node.id);
      if (node.data.node.type === "agent" || node.data.node.type === "group")
        props.onOpen?.(node.id);
      // A script has no session to open; double-click edits it instead.
      if (node.data.node.type === "script") props.onEdit?.(node.id);
    },
    onEdgeClick: (event, edge) => graph.selectLink(edge.data?.link ?? null),
    onEdgesChange: (changes) => {
      const selection = changes.find(
        (change) => change.type === "select" && change.selected,
      );
      if (!selection || selection.type !== "select") return;
      graph.selectLink(
        planLinks(props.draft).find(
          (link) => planLinkKey(link) === selection.id,
        ) ?? null,
      );
    },
    onPaneClick: () => graph.select(null),
  };
}
