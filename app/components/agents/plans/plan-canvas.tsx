import {
  Background,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";
import { useTranslation } from "react-i18next";

import { PlanCanvasControls } from "./plan-canvas-controls";
import { PlanFlowConnectionLine } from "./plan-flow-connection-line";
import { PlanFlowContext } from "./plan-flow-context";
import { PlanFlowEdgeView } from "./plan-flow-edge";
import { planFlowEdges, planFlowNodes } from "./plan-flow-model";
import { PlanGroupNoticeBar } from "./plan-group-notice";
import { PlanGroupRemoval } from "./plan-group-removal";
import { PLAN_GRID } from "./plan-layout";
import { PlanNodeCard } from "./plan-node-card";
import { usePlanCanvasDrop } from "./use-plan-canvas-drop";
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

/** The execution plan uses React Flow for rendering, measurement, connections and viewport gestures. */
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
  const { graph } = props;
  const flow = useReactFlow<PlanFlowNode, PlanFlowEdge>();
  const movement = usePlanFlowMovement(props);
  const { cancel: cancelConnection, ...connections } =
    usePlanFlowConnections(props);
  const drop = usePlanCanvasDrop({
    ...props,
    toGrid: (x, y) => flow.screenToFlowPosition({ x, y }),
  });
  const onKeyDown = usePlanCanvasKeys({ ...props, onCancel: cancel });
  const context = {
    ...props,
    dropTarget: drop.dropTarget ?? movement.dropTarget,
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
        onDragOver={drop.onDragOver}
        onDragLeave={drop.onDragLeave}
        onDrop={drop.onDrop}
        className="absolute inset-0 overflow-hidden rounded-2xl border border-border bg-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <PlanFlowGraph
          canvas={props}
          movement={movement}
          connections={connections}
        />
        {props.draft.nodes.length === 0 ? (
          <CanvasEmpty
            hasWorkspace={Boolean(props.draft.workspaceId)}
            isReadOnly={props.isReadOnly ?? !props.canEdit}
          />
        ) : null}
        {graph.notice ? (
          <PlanGroupNoticeBar
            notice={graph.notice}
            onClose={graph.clearNotice}
            className="absolute top-20 left-3 z-10"
          />
        ) : null}
        <PlanGroupRemoval
          draft={props.draft}
          graph={graph}
          canEdit={props.canEdit}
        />
      </section>
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
      fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
      aria-label={t("plans.grid")}
      ariaLabelConfig={ariaLabelConfig}
    >
      <Background gap={PLAN_GRID} size={1} />
      <PlanCanvasControls />
    </ReactFlow>
  );
}

function CanvasEmpty(props: {
  readonly hasWorkspace: boolean;
  readonly isReadOnly: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  let hint = "plans.flow.workspaceHint";
  if (props.hasWorkspace) hint = "plans.flow.emptyHint";
  if (props.isReadOnly) hint = "plans.flow.emptyReadOnlyHint";
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-8">
      <div className="max-w-sm rounded-2xl border border-dashed border-border bg-surface/90 p-6 text-center shadow-xs">
        <p className="mb-2 text-sm font-semibold">
          {t(
            props.isReadOnly
              ? "plans.flow.emptyReadOnlyTitle"
              : "plans.flow.emptyTitle",
          )}
        </p>
        <p className="text-sm text-muted-foreground">{t(hint)}</p>
      </div>
    </div>
  );
}
