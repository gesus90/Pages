import { useReactFlow, useStore } from "@xyflow/react";
import { Minus, Plus, Scan } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";

import type { FitViewOptions } from "@xyflow/react";
import type { PlanFlowEdge, PlanFlowNode } from "./plan-flow-model";

/**
 * Fitting keeps the graph clear of the zoom bar above it and of the canvas edges.
 *
 * @remarks
 * Fitting never enlarges a small plan beyond its natural size.
 */
export const PLAN_FIT_VIEW: FitViewOptions<PlanFlowNode> = {
  padding: { top: "84px", right: "56px", bottom: "56px", left: "56px" },
  maxZoom: 1,
};

/**
 * The only canvas control: zoom out, the current zoom, zoom in and fit.
 *
 * @remarks
 * The percentage reads React Flow's viewport, so wheel, pinch and the
 * buttons always show the zoom the canvas really has.
 */
export function PlanCanvasControls(): React.ReactElement {
  const { t } = useTranslation();
  const flow = useReactFlow<PlanFlowNode, PlanFlowEdge>();
  const zoom = useStore((state) => state.transform[2]);
  const isSmallest = useStore((state) => state.transform[2] <= state.minZoom);
  const isLargest = useStore((state) => state.transform[2] >= state.maxZoom);
  function zoomOut(): void {
    void flow.zoomOut();
  }
  function zoomIn(): void {
    void flow.zoomIn();
  }
  function fit(): void {
    void flow.fitView(PLAN_FIT_VIEW);
  }
  return (
    <div
      role="toolbar"
      aria-label={t("plans.flow.tools")}
      className="pointer-events-auto flex items-center gap-0.5 rounded-xl border border-border/70 bg-surface/80 p-1 text-foreground shadow-xs backdrop-blur-sm"
    >
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label={t("plans.zoomOut")}
        title={t("plans.zoomOut")}
        disabled={isSmallest}
        onClick={zoomOut}
      >
        <Minus className="size-4" aria-hidden="true" />
      </Button>
      <output
        aria-label={t("plans.zoomLevel")}
        className="min-w-12 text-center text-xs font-medium text-muted-foreground tabular-nums"
      >
        {Math.round(zoom * 100)} %
      </output>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label={t("plans.zoomIn")}
        title={t("plans.zoomIn")}
        disabled={isLargest}
        onClick={zoomIn}
      >
        <Plus className="size-4" aria-hidden="true" />
      </Button>
      <span aria-hidden="true" className="mx-0.5 h-5 w-px bg-border" />
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label={t("plans.flow.fitView")}
        title={t("plans.flow.fitView")}
        onClick={fit}
      >
        <Scan className="size-4" aria-hidden="true" />
      </Button>
    </div>
  );
}
