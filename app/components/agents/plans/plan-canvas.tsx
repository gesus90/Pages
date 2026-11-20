import {
  getBezierPath,
  ReactFlow,
  ReactFlowProvider,
  useConnection,
} from "@xyflow/react";
import { CircleAlert, X } from "lucide-react";
import { lazy, Suspense, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { cn } from "@/app/lib/cn";
import { planPendingSelections } from "@/definition/AgentPlanSelection";

import { PLAN_FIT_VIEW, PlanCanvasControls } from "./plan-canvas-controls";
import { planRefusalKey } from "./plan-connection-refusal";
import { PlanFlowContext, usePlanFlowContext } from "./plan-flow-context";
import { PlanFlowEdgeView } from "./plan-flow-edge";
import { planFlowEdges, planFlowNodes } from "./plan-flow-model";
import { PlanGroupRemoval } from "./plan-group-removal";
import {
  PLAN_LINK_DASH,
  PLAN_LINK_STROKE,
  planConnectionChannel,
} from "./plan-link-style";
import { planLinkKey, planLinks } from "./plan-links";
import { PlanNodeCard } from "./plan-node-card";
import { PlanRunStatus } from "./plan-run-status";
import { PlanNodePalette } from "./plan-node-palette";
import { usePlanNodePalette } from "./use-plan-node-palette";
import { usePlanFlowConnections } from "./use-plan-flow-connections";
import { usePlanFlowMovement } from "./use-plan-flow-movement";
import { usePlanTemplates } from "./plan-templates/use-plan-templates";
import styles from "./plan-canvas.module.css";

import type {
  AriaLabelConfig,
  ConnectionLineComponentProps,
  ReactFlowProps,
} from "@xyflow/react";
import type { AgentPlanInput, AgentPlanNode } from "@/definition/AgentPlan";
import type { PlanCanvasProps } from "./plan-flow-context";
import type { PlanFlowEdge, PlanFlowNode } from "./plan-flow-model";
import type { PlanTemplates } from "./plan-templates/use-plan-templates";
import type { PlanGraphActions } from "./use-plan-graph";
import type { PlanGroupNotice } from "./use-plan-group-actions";

const NODE_TYPES = { plan: PlanNodeCard };
const EDGE_TYPES = { plan: PlanFlowEdgeView };
// Hides React Flow's corner link; the MIT license permits it and the notice stays with the source.
const PRO_OPTIONS = { hideAttribution: true };
// Saving a node template is rare; its dialog loads when it is asked for.
const PlanTemplateDialog = lazy(async () => ({
  default: (await import("./plan-templates/plan-template-dialog"))
    .PlanTemplateDialog,
}));

/**
 * The execution plan uses React Flow for rendering, measurement, connections and viewport gestures.
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
      defaultViewport={{ x: 40, y: 80, zoom: 1 }}
      fitView
      fitViewOptions={PLAN_FIT_VIEW}
      zIndexMode="manual"
      proOptions={PRO_OPTIONS}
      aria-label={t("plans.grid")}
      ariaLabelConfig={ariaLabelConfig}
    ></ReactFlow>
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
        <PlanSelectionNotice canvas={canvas} />
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
    <Suspense fallback={null}>
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
    </Suspense>
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
      {issue ? t(planRefusalKey(issue)) : t("plans.connectHint")}
      <Button size="xs" variant="ghost" onClick={cancelConnection}>
        {t("settings.agents.cancel")}
      </Button>
    </div>
  );
}

function usePlanFlowAria(): Partial<AriaLabelConfig> {
  const { t } = useTranslation();
  return {
    "node.a11yDescription.default": t("plans.flow.nodeKeys"),
    "node.a11yDescription.keyboardDisabled": t("plans.flow.nodeReadOnlyKeys"),
    "node.a11yDescription.ariaLiveMessage": ({ x, y }) =>
      t("plans.flow.nodeMoved", { x, y }),
    "edge.a11yDescription.default": t("plans.flow.edgeKeys"),
  };
}

function PlanSelectionNotice({
  canvas,
}: {
  readonly canvas: PlanCanvasProps;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const pending = planPendingSelections(canvas.draft);
  const first = pending[0];
  if (!first) return null;
  function openFirst(): void {
    if (!first) return;
    canvas.graph.select(first.id);
    canvas.onEdit?.(first.id);
  }
  return (
    <div
      role="status"
      className="pointer-events-auto flex h-11 w-full shrink-0 items-center gap-2 bg-primary-subtle px-4 text-sm"
    >
      <CircleAlert
        aria-hidden="true"
        className="size-4 shrink-0 text-primary"
      />
      <p>
        <strong>
          {t("plans.manage.selectionSteps", { count: pending.length })}
        </strong>{" "}
        {t("plans.manage.selectionNeeded")}
      </p>
      <button
        type="button"
        className="ml-auto shrink-0 text-primary underline-offset-2 hover:underline"
        onClick={openFirst}
      >
        {t("plans.manage.selectionFirst")}
      </button>
    </div>
  );
}

function usePlanGroupCollapse(
  draft: AgentPlanInput,
  graph: PlanGraphActions,
): {
  readonly collapsedGroups: ReadonlySet<string>;
  readonly toggleGroup: (id: string) => void;
} {
  const [collapsedGroups, setCollapsed] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const selections = useRef(new Map<string, string>());
  function toggleGroup(id: string): void {
    const group = draft.nodes.find(
      (node) => node.id === id && node.type === "group",
    );
    if (group?.type !== "group") return;
    const next = new Set(collapsedGroups);
    if (next.has(id)) {
      next.delete(id);
      const selected = selections.current.get(id);
      if (
        graph.selectedId === id &&
        selected !== undefined &&
        group.steps.some((step) => step.id === selected)
      )
        graph.select(selected);
      selections.current.delete(id);
    } else {
      next.add(id);
      const { selectedId } = graph;
      if (
        selectedId !== null &&
        group.steps.some((step) => step.id === selectedId)
      ) {
        selections.current.set(id, selectedId);
        graph.select(id);
      }
    }
    setCollapsed(next);
  }
  return { collapsedGroups, toggleGroup };
}

function PlanFlowConnectionLine(
  props: ConnectionLineComponentProps,
): React.ReactElement | null {
  const { graph } = usePlanFlowContext();
  if (!graph.connection) return null;
  const channel = planConnectionChannel(graph.connection);
  const [path] = getBezierPath({
    sourceX: props.fromX,
    sourceY: props.fromY,
    sourcePosition: props.fromPosition,
    targetX: props.toX,
    targetY: props.toY,
    targetPosition: props.toPosition,
  });
  const color = PLAN_LINK_STROKE[channel];
  return (
    <g>
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeDasharray={PLAN_LINK_DASH[channel]}
      />
      <circle
        cx={props.toX}
        cy={props.toY}
        r={4}
        fill="var(--color-surface)"
        stroke={
          props.connectionStatus === "invalid"
            ? "var(--color-destructive)"
            : color
        }
        strokeWidth={2}
      />
    </g>
  );
}

const DELETE_KEYS = new Set(["Delete", "Backspace"]);

function deletesSelection(
  event: React.KeyboardEvent<HTMLElement>,
  selectedId: string | null,
): boolean {
  const target = event.target;
  if (target === event.currentTarget) return true;
  return (
    target instanceof Element &&
    ((target instanceof HTMLElement &&
      selectedId !== null &&
      target.dataset.planHandle === selectedId) ||
      target.matches(".react-flow__pane, .react-flow__node, .react-flow__edge"))
  );
}

function usePlanCanvasKeys(options: {
  readonly graph: PlanGraphActions;
  readonly canEdit: boolean;
  readonly onCancel: () => void;
}): (event: React.KeyboardEvent<HTMLElement>) => void {
  const { graph, canEdit } = options;
  return (event) => {
    if (event.key === "Escape") {
      options.onCancel();
      graph.begin(null);
      return;
    }
    const { selectedLink, selectedId } = graph;
    if (!canEdit || !DELETE_KEYS.has(event.key)) return;
    if (!deletesSelection(event, selectedId)) return;
    if (selectedLink) {
      event.preventDefault();
      graph.disconnect(selectedLink);
    } else if (selectedId) {
      event.preventDefault();
      graph.remove(selectedId);
    }
  };
}

const NOTICE_AREAS = {
  group: "groups",
  loop: "loops",
  stack: "stack",
} as const;

function useNoticeText(notice: PlanGroupNotice): string {
  const { t } = useTranslation();
  if (notice.kind === "repair")
    return t("plans.groups.frameRepairRequired", { name: notice.name });
  if (notice.kind === "moved")
    return t(`plans.${NOTICE_AREAS[notice.frame]}.moved`, {
      edges: notice.removedEdges,
      bindings: notice.removedBindings,
    });
  return t(`plans.groups.refusal.${notice.refusal}`, {
    name: notice.name,
    adapter: t(`plans.groups.adapter.${notice.adapter ?? "neutral"}`),
    group: t(`plans.groups.adapter.${notice.groupAdapter ?? "neutral"}`),
  });
}

function PlanGroupNoticeBar(props: {
  readonly notice: PlanGroupNotice;
  readonly onClose: () => void;
  readonly className?: string;
}): React.ReactElement {
  const { t } = useTranslation();
  const text = useNoticeText(props.notice);
  const isRefusal = props.notice.kind !== "moved";
  return (
    <div
      role={isRefusal ? "alert" : "status"}
      className={cn(
        "flex max-w-[min(36rem,calc(100%-1rem))] items-start gap-2 rounded-lg border bg-surface p-2 pl-3 text-sm shadow-xs",
        isRefusal ? "border-destructive/40 text-destructive" : "border-border",
        props.className,
      )}
    >
      <p className="min-w-0 flex-1">{text}</p>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label={t("plans.groups.closeNotice")}
        onClick={props.onClose}
      >
        <X className="size-4" aria-hidden="true" />
      </Button>
    </div>
  );
}

const OPENS_CONSOLE: ReadonlySet<AgentPlanNode["type"]> = new Set([
  "agent",
  "group",
  "swarm",
]);

const OPENS_SETTINGS: ReadonlySet<AgentPlanNode["type"]> = new Set([
  "script",
  "git_closeout",
  "loop",
  "decision",
  "stack",
  "start",
  "end",
  "jump",
  "signal",
]);

function usePlanFlowSelection(
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
      if (OPENS_CONSOLE.has(node.data.node.type)) props.onOpen?.(node.id);
      if (OPENS_SETTINGS.has(node.data.node.type)) props.onEdit?.(node.id);
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
