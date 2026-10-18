import {
  Background,
  ReactFlow,
  ReactFlowProvider,
  useConnection,
} from "@xyflow/react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { cn } from "@/app/lib/cn";

import { PLAN_FIT_VIEW, PlanCanvasControls } from "./plan-canvas-controls";
import { PlanFlowConnectionLine } from "./plan-flow-connection-line";
import { PlanFlowContext, usePlanFlowContext } from "./plan-flow-context";
import { PlanFlowEdgeView } from "./plan-flow-edge";
import { planFlowEdges, planFlowNodes } from "./plan-flow-model";
import { PlanGroupNoticeBar } from "./plan-group-notice";
import { PlanGroupRemoval } from "./plan-group-removal";
import { PLAN_GRID } from "./plan-layout";
import { PlanNodeCard } from "./plan-node-card";
import { PlanNodePalette } from "./plan-node-palette";
import { usePlanNodePalette } from "./use-plan-node-palette";
import { usePlanCanvasKeys } from "./use-plan-canvas-keys";
import { usePlanFlowAria } from "./use-plan-flow-aria";
import { usePlanFlowConnections } from "./use-plan-flow-connections";
import { usePlanFlowMovement } from "./use-plan-flow-movement";
import { usePlanFlowSelection } from "./use-plan-flow-selection";
import styles from "./plan-canvas.module.css";

import type { PlanCanvasProps } from "./plan-flow-context";
import type { PlanFlowEdge, PlanFlowNode } from "./plan-flow-model";

const NODE_TYPES = { plan: PlanNodeCard };
const EDGE_TYPES = { plan: PlanFlowEdgeView };
// Hides React Flow's corner link; the MIT license permits it and the notice stays with the source.
const PRO_OPTIONS = { hideAttribution: true };

/**
 * The execution plan uses React Flow for rendering, measurement, connections and viewport gestures.
 *
 * @remarks
 * The canvas fills its container. Page controls, the zoom bar and notices
 * share a floating stack outside its gestures and keyboard shortcuts.
 */
export function PlanCanvas(props: PlanCanvasProps): React.ReactElement {
  return (
    <ReactFlowProvider
      initialNodes={planFlowNodes(props.draft, {
        sources: props.sources,
        selectedId: props.graph.selectedId,
        canEdit: props.canEdit,
      })}
      initialEdges={planFlowEdges(
        props.draft,
        props.sources,
        props.graph.selectedLink,
      )}
    >
      <PlanFlowCanvas {...props} />
    </ReactFlowProvider>
  );
}

function PlanFlowCanvas(props: PlanCanvasProps): React.ReactElement {
  const { t } = useTranslation();
  const movement = usePlanFlowMovement(props);
  const palette = usePlanNodePalette(props);
  const { cancel: cancelConnection, ...connections } =
    usePlanFlowConnections(props);
  const onKeyDown = usePlanCanvasKeys({ ...props, onCancel: cancel });
  const context = {
    ...props,
    dropTarget: movement.dropTarget,
    cancelConnection,
  };
  function cancel(): void {
    movement.cancel();
    cancelConnection();
  }
  return (
    <PlanFlowContext value={context}>
      <section
        aria-label={t("plans.canvas")}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onDragOver={palette.dragOver}
        onDrop={palette.drop}
        className="absolute inset-0 overflow-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
      >
        <PlanFlowGraph
          canvas={props}
          movement={movement}
          connections={connections}
        />
        <PlanGroupRemoval
          draft={props.draft}
          graph={props.graph}
          canEdit={props.canEdit}
        />
      </section>
      <PlanCanvasOverlay canvas={props} palette={palette} />
    </PlanFlowContext>
  );
}

function PlanFlowGraph({
  canvas,
  movement,
  connections,
}: {
  readonly canvas: PlanCanvasProps;
  readonly movement: ReturnType<typeof usePlanFlowMovement>;
  readonly connections: Omit<
    ReturnType<typeof usePlanFlowConnections>,
    "cancel"
  >;
}): React.ReactElement {
  const { t } = useTranslation();
  const selection = usePlanFlowSelection(canvas);
  const ariaLabelConfig = usePlanFlowAria();
  return (
    <ReactFlow<PlanFlowNode, PlanFlowEdge>
      className={styles.canvas}
      nodes={movement.nodes}
      edges={planFlowEdges(
        canvas.draft,
        canvas.sources,
        canvas.graph.selectedLink,
      )}
      nodeTypes={NODE_TYPES}
      edgeTypes={EDGE_TYPES}
      onNodesChange={movement.onNodesChange}
      onNodeDragStart={movement.onNodeDragStart}
      onNodeDrag={movement.onNodeDrag}
      onNodeDragStop={movement.onNodeDragStop}
      {...selection}
      {...connections}
      connectionLineComponent={PlanFlowConnectionLine}
      nodesDraggable={canvas.canEdit}
      nodesConnectable={canvas.canEdit}
      selectNodesOnDrag={canvas.graph.selectedLink === null}
      edgesReconnectable={false}
      deleteKeyCode={null}
      multiSelectionKeyCode={null}
      selectionKeyCode={null}
      zoomOnDoubleClick={false}
      minZoom={0.01}
      maxZoom={2}
      snapToGrid
      snapGrid={[PLAN_GRID, PLAN_GRID]}
      defaultViewport={{ x: 40, y: 80, zoom: 1 }}
      fitView
      fitViewOptions={PLAN_FIT_VIEW}
      zIndexMode="manual"
      proOptions={PRO_OPTIONS}
      aria-label={t("plans.grid")}
      ariaLabelConfig={ariaLabelConfig}
    >
      <Background
        gap={PLAN_GRID}
        size={1}
        bgColor="transparent"
        className={styles.grid}
      />
    </ReactFlow>
  );
}

function PlanCanvasOverlay({
  canvas,
  palette,
}: {
  readonly canvas: PlanCanvasProps;
  readonly palette: ReturnType<typeof usePlanNodePalette>;
}): React.ReactElement {
  return (
    <div className="pointer-events-none absolute inset-4 bottom-[calc(env(safe-area-inset-bottom)+8rem)] z-10 flex min-h-0 flex-col items-start gap-3 @5xl:flex-row @5xl:justify-between md:bottom-[calc(env(safe-area-inset-bottom)+5rem)]">
      <div className="flex max-h-1/2 w-full max-w-3xl shrink-0 flex-col items-start gap-2 @5xl:max-h-full @5xl:min-w-0 @5xl:flex-1">
        {canvas.panel}
        <div className="flex w-full shrink-0 flex-col items-start gap-2">
          <PlanCanvasControls />
          <PlanConnectionHint />
          {canvas.graph.notice ? (
            <PlanGroupNoticeBar
              notice={canvas.graph.notice}
              onClose={canvas.graph.clearNotice}
              className="pointer-events-auto"
            />
          ) : null}
          {canvas.status}
        </div>
      </div>
      <PlanNodePalette canvas={canvas} palette={palette} />
    </div>
  );
}

/**
 * Port buttons connect in two steps; while no drag shows the line, this tells
 * what comes next and why a chosen IN refused the connection.
 */
function PlanConnectionHint(): React.ReactElement | null {
  const { t } = useTranslation();
  const { graph, cancelConnection } = usePlanFlowContext();
  const isDragging = useConnection((connection) => connection.inProgress);
  if (!graph.connection || isDragging) return null;
  const issue = graph.connectionIssue;
  return (
    <div
      role="status"
      className={cn(
        "pointer-events-auto flex items-center gap-2 rounded-lg border bg-surface p-1.5 pl-3 text-xs shadow-xs",
        issue ? "border-destructive/40 text-destructive" : "border-border",
      )}
    >
      {issue ? t(`plans.validation.${issue.reason}`) : t("plans.connectHint")}
      <Button size="xs" variant="ghost" onClick={cancelConnection}>
        {t("settings.agents.cancel")}
      </Button>
    </div>
  );
}
