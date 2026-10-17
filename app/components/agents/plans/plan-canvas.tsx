import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import styles from "./plan-canvas.module.css";
import { PlanCanvasControls } from "./plan-canvas-controls";
import { PlanEdges } from "./plan-edges";
import { PlanGroupFrame } from "./plan-group-frame";
import { planRunGroupSession } from "./plan-group-session";
import { PlanGroupNoticeBar } from "./plan-group-notice";
import { PlanGroupRemoval } from "./plan-group-removal";
import { PlanLinkAction } from "./plan-link-action";
import { PlanNodeCard } from "./plan-node-card";
import {
  PLAN_GRID,
  planMemberPosition,
  planNodeHeight,
  planNodeWidth,
} from "./plan-layout";
import { usePlanCanvasDrop } from "./use-plan-canvas-drop";
import { usePlanCanvasKeys } from "./use-plan-canvas-keys";
import { usePlanPointerGestures } from "./use-plan-pointer-gestures";
import { usePlanViewport } from "./use-plan-viewport";

import type {
  AgentPlanInput,
  AgentPlanSources,
  AgentPlanRun,
} from "@/definition/AgentPlan";
import type { PlanGraphActions } from "./use-plan-graph";
import type { PlanPointerGestures } from "./use-plan-pointer-gestures";
import type { PlanViewport, PlanViewportPointer } from "./use-plan-viewport";

// Keeps the first nodes of a plan below the configuration bar that floats over the grid.
const INITIAL_VIEW = { x: 24, y: 120, zoom: 1 };

interface CanvasProps {
  readonly draft: AgentPlanInput;
  readonly sources: AgentPlanSources;
  readonly graph: PlanGraphActions;
  readonly canEdit: boolean;
  readonly run: AgentPlanRun | null;
  readonly onEdit?: (id: string) => void;
}

/** The layer is as large as its content, so connections are not clipped by it. */
function planLayerSize(
  draft: AgentPlanInput,
  sources: AgentPlanSources,
): { readonly width: number; readonly height: number } {
  return {
    width: Math.max(
      1000,
      ...draft.nodes.map((node) => node.x + planNodeWidth(node) + 100),
    ),
    height: Math.max(
      500,
      ...draft.nodes.map(
        (node) => node.y + planNodeHeight(node, sources) + 100,
      ),
    ),
  };
}

/**
 * Node moves and dragged connections take a press first; a press on the empty
 * grid falls through to panning.
 */
function combinePointerHandlers(
  gestures: PlanPointerGestures,
  viewport: PlanViewport,
): PlanViewportPointer {
  const { pointer } = viewport;
  return {
    onPointerDown: (event) => {
      gestures.onPointerDown(event);
      pointer.onPointerDown(event);
    },
    onPointerMove: (event) => {
      gestures.onPointerMove(event);
      pointer.onPointerMove(event);
    },
    onPointerUp: (event) => {
      gestures.onPointerUp(event);
      pointer.onPointerUp(event);
    },
    onPointerCancel: (event) => {
      gestures.cancel();
      pointer.onPointerCancel(event);
    },
  };
}

/** Frames first, then connections, then the cards of members and other nodes on top. */
function PlanLayer(
  props: CanvasProps & {
    readonly dropTarget: string | null;
    readonly gestures: PlanPointerGestures;
  },
): React.ReactElement {
  const { draft, graph, gestures } = props;
  const groups = draft.nodes.filter((node) => node.type === "group");
  const { nodePreview, linkPreview } = gestures;
  const target = linkPreview?.target;
  function result(id: string): AgentPlanRun["steps"][number] | undefined {
    return props.run?.steps.find((step) => step.id === id);
  }
  return (
    <>
      {groups.map((group) => (
        <PlanGroupFrame
          key={group.id}
          group={group}
          sources={props.sources}
          graph={graph}
          canEdit={props.canEdit}
          isDropTarget={props.dropTarget === group.id}
          session={planRunGroupSession(props.run, group.id)}
          result={result(group.id)}
          onEdit={props.onEdit}
        />
      ))}
      <PlanEdges
        plan={draft}
        sources={props.sources}
        selected={graph.selectedLink}
        onSelect={graph.selectLink}
        preview={
          linkPreview && {
            line: linkPreview,
            isValid: target
              ? graph.canConnect(target.id, target.parameter)
              : null,
          }
        }
      />
      {groups.flatMap((group) =>
        group.steps.map((step) => (
          <PlanNodeCard
            key={step.id}
            {...props}
            node={step}
            position={
              nodePreview?.id === step.id
                ? nodePreview
                : planMemberPosition(group, step)
            }
            result={result(step.id)}
          />
        )),
      )}
      {draft.nodes
        .filter((node) => node.type !== "group")
        .map((node) => (
          <PlanNodeCard
            key={node.id}
            {...props}
            node={node}
            result={result(node.id)}
          />
        ))}
      <PlanLinkAction
        draft={draft}
        sources={props.sources}
        graph={graph}
        canEdit={props.canEdit}
      />
    </>
  );
}

/**
 * The plan grid fills its area; dragging the empty grid pans it and the mouse wheel zooms it.
 *
 * @remarks
 * Nodes, frames and connections share one transformed layer, so they keep
 * their positions relative to each other at every offset and zoom level. The
 * grid has no surface of its own: it shows the page background with a faint
 * dot raster that fades out towards every edge of the visible area, so the
 * grid blends into the page and the panels above it read as floating. Only
 * the raster fades; nodes, ports and connections stay fully visible.
 */
export function PlanCanvas(props: CanvasProps): React.ReactElement {
  const { t } = useTranslation();
  const { graph } = props;
  const viewport = usePlanViewport(() => graph.select(null), INITIAL_VIEW);
  const drop = usePlanCanvasDrop({
    draft: props.draft,
    sources: props.sources,
    graph,
    canEdit: props.canEdit,
    toGrid: viewport.toGrid,
  });
  const gestures = usePlanPointerGestures({
    draft: props.draft,
    sources: props.sources,
    graph,
    canEdit: props.canEdit,
    toGrid: viewport.toGrid,
  });
  const onKeyDown = usePlanCanvasKeys({
    graph,
    canEdit: props.canEdit,
    onCancel: gestures.cancel,
  });
  const pointer = combinePointerHandlers(gestures, viewport);
  const { view } = viewport;
  return (
    <section aria-label={t("plans.canvas")} className="absolute inset-0">
      <div
        ref={viewport.viewportRef}
        role="region"
        aria-label={t("plans.grid")}
        tabIndex={0}
        onDragOver={drop.onDragOver}
        onDragLeave={drop.onDragLeave}
        onDrop={drop.onDrop}
        onKeyDown={onKeyDown}
        {...pointer}
        className="relative size-full cursor-grab touch-none overflow-hidden outline-none select-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset active:cursor-grabbing"
      >
        <div
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute inset-0",
            styles.gridBackground,
          )}
          style={{
            backgroundSize: `${PLAN_GRID * view.zoom}px ${PLAN_GRID * view.zoom}px`,
            backgroundPosition: `${view.x}px ${view.y}px`,
          }}
        />
        <div
          data-plan-layer=""
          className="absolute top-0 left-0 origin-top-left"
          style={{
            ...planLayerSize(props.draft, props.sources),
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`,
          }}
        >
          <PlanLayer
            {...props}
            dropTarget={drop.dropTarget ?? gestures.dropTarget}
            gestures={gestures}
          />
        </div>
      </div>
      <PlanCanvasControls graph={graph} viewport={viewport} />
      {graph.notice ? (
        <PlanGroupNoticeBar
          notice={graph.notice}
          onClose={graph.clearNotice}
          className="absolute top-14 left-1/2 z-[5] -translate-x-1/2 xl:top-48"
        />
      ) : null}
      <PlanGroupRemoval
        draft={props.draft}
        graph={graph}
        canEdit={props.canEdit}
      />
    </section>
  );
}
