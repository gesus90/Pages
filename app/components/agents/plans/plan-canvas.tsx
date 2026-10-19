import {
  Background,
  ReactFlow,
  ReactFlowProvider,
  useConnection,
} from "@xyflow/react";
import { useState } from "react";
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
import { PlanRunStatus } from "./plan-run-status";
import { PlanNodePalette } from "./plan-node-palette";
import { usePlanNodePalette } from "./use-plan-node-palette";
import { usePlanCanvasKeys } from "./use-plan-canvas-keys";
import { usePlanFlowAria } from "./use-plan-flow-aria";
import { usePlanFlowConnections } from "./use-plan-flow-connections";
import { usePlanFlowMovement } from "./use-plan-flow-movement";
import { usePlanFlowSelection } from "./use-plan-flow-selection";
import { usePlanGroupCollapse } from "./use-plan-group-collapse";
import { PlanTemplateDialog } from "./plan-templates/plan-template-dialog";
import { usePlanTemplates } from "./plan-templates/use-plan-templates";
import styles from "./plan-canvas.module.css";

import type { PlanCanvasProps } from "./plan-flow-context";
import type { PlanFlowEdge, PlanFlowNode } from "./plan-flow-model";
import type { PlanTemplates } from "./plan-templates/use-plan-templates";

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
  const [isStatusOpen, setStatusOpen] = useState(false);
  const collapse = usePlanGroupCollapse(props.draft, props.graph);
  const movement = usePlanFlowMovement({ ...props, ...collapse });
  const palette = usePlanNodePalette(props);
  const templates = usePlanTemplates(props, palette.blocked);
  const { cancel: cancelConnection, ...connections } =
    usePlanFlowConnections(props);
  const onKeyDown = usePlanCanvasKeys({ ...props, onCancel: cancel });
  const context = {
    ...props,
    ...collapse,
    dropTarget: movement.dropTarget,
    cancelConnection,
    requestTemplate: templates.requestSave,
  };
  function cancel(): void {
    movement.cancel();
    cancelConnection();
  }
  // Node types and saved templates drop onto the same canvas.
  function dragOver(event: React.DragEvent): void {
    palette.dragOver(event);
    templates.insertion.dragOver(event);
  }
  function drop(event: React.DragEvent): void {
    palette.drop(event);
    templates.insertion.drop(event);
  }
  return (
    <PlanFlowContext value={context}>
      <section
        aria-label={t("plans.canvas")}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onDragOver={dragOver}
        onDrop={drop}
        className="absolute inset-0 overflow-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
      >
        <PlanFlowGraph
          canvas={props}
          collapsedGroups={collapse.collapsedGroups}
          movement={movement}
          connections={connections}
        />
        <PlanGroupRemoval
          draft={props.draft}
          graph={props.graph}
          canEdit={props.canEdit}
        />
      </section>
      <PlanCanvasOverlay
        canvas={props}
        palette={palette}
        templates={templates}
        isStatusOpen={isStatusOpen}
      />
      <PlanTemplateSave canvas={props} templates={templates} />
      <PlanRunStatus
        canvas={props}
        isOpen={isStatusOpen}
        onToggle={() => setStatusOpen(!isStatusOpen)}
      />
    </PlanFlowContext>
  );
}

function PlanFlowGraph({
  canvas,
  movement,
  collapsedGroups,
  connections,
}: {
  readonly canvas: PlanCanvasProps;
  readonly collapsedGroups: ReadonlySet<string>;
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
        collapsedGroups,
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
  templates,
  isStatusOpen,
}: {
  readonly canvas: PlanCanvasProps;
  readonly palette: ReturnType<typeof usePlanNodePalette>;
  readonly templates: PlanTemplates;
  readonly isStatusOpen: boolean;
}): React.ReactElement {
  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-4 z-10 flex min-h-0 flex-col items-start gap-3 overflow-y-auto overscroll-contain @5xl:flex-row @5xl:overflow-visible @5xl:justify-between",
        isStatusOpen
          ? "bottom-[calc(min(26rem,36%)+9.5rem)] md:bottom-[calc(min(21.25rem,58%)+2.5rem)] @5xl:bottom-4"
          : "bottom-[calc(env(safe-area-inset-bottom)+14rem)] md:bottom-[calc(env(safe-area-inset-bottom)+7rem)] @5xl:bottom-4",
      )}
    >
      <div
        data-plan-upper-stack
        className="flex max-h-full w-full max-w-3xl shrink-0 flex-col items-start gap-2 @5xl:max-h-full @5xl:min-w-0 @5xl:flex-1"
      >
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
      <PlanNodePalette
        canvas={canvas}
        palette={palette}
        templates={templates}
      />
    </div>
  );
}

/** The save dialog of a node template, while one is requested. */
function PlanTemplateSave({
  canvas,
  templates,
}: {
  readonly canvas: PlanCanvasProps;
  readonly templates: PlanTemplates;
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (!templates.saving) return null;
  return (
    <PlanTemplateDialog
      key={templates.saving.id}
      node={templates.saving}
      target={{
        planId: canvas.planId ?? "",
        workspaceId: canvas.draft.workspaceId,
      }}
      context={{
        draft: canvas.draft,
        sources: canvas.sources,
        workspaces: canvas.workspaces ?? [],
        translate: t,
      }}
      onSaved={templates.saved}
      onClose={templates.closeSave}
    />
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
