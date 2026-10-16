import { useTranslation } from "react-i18next";

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
import { usePlanViewport } from "./use-plan-viewport";

import type {
  AgentPlanInput,
  AgentPlanSources,
  AgentPlanRun,
} from "@/definition/AgentPlan";
import type { PlanGraphActions } from "./use-plan-graph";

// Keys that delete the selected node or connection while the grid has focus.
const DELETE_KEYS = new Set(["Delete", "Backspace"]);
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

/** Frames first, then connections, then the cards of members and other nodes on top. */
function PlanLayer(
  props: CanvasProps & {
    readonly dropTarget: string | null;
    readonly onDragNode: (id: string) => void;
  },
): React.ReactElement {
  const { draft, graph } = props;
  const groups = draft.nodes.filter((node) => node.type === "group");
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
          onDragNode={props.onDragNode}
        />
      ))}
      <PlanEdges
        plan={draft}
        sources={props.sources}
        selected={graph.selectedLink}
        onSelect={graph.selectLink}
      />
      {groups.flatMap((group) =>
        group.steps.map((step) => (
          <PlanNodeCard
            key={step.id}
            {...props}
            node={step}
            position={planMemberPosition(group, step)}
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
 * dot raster, so the panels above it read as floating.
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
  const { view } = viewport;
  const width = Math.max(
    1000,
    ...props.draft.nodes.map((node) => node.x + planNodeWidth(node) + 100),
  );
  const height = Math.max(
    500,
    ...props.draft.nodes.map(
      (node) => node.y + planNodeHeight(node, props.sources) + 100,
    ),
  );
  function deleteSelection(event: React.KeyboardEvent<HTMLDivElement>): void {
    const { selectedLink, selectedId } = graph;
    // Keys typed into a field or a button inside the grid never delete a node.
    if (event.target !== event.currentTarget) return;
    if (!props.canEdit || !DELETE_KEYS.has(event.key)) return;
    if (!selectedLink && !selectedId) return;
    event.preventDefault();
    if (selectedLink) graph.disconnect(selectedLink);
    else if (selectedId) graph.remove(selectedId);
  }
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
        onKeyDown={deleteSelection}
        {...viewport.pointer}
        className="relative size-full cursor-grab touch-none overflow-hidden rounded-xl bg-transparent bg-[radial-gradient(var(--color-border)_1px,transparent_1px)] outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset active:cursor-grabbing"
        style={{
          backgroundSize: `${PLAN_GRID * view.zoom}px ${PLAN_GRID * view.zoom}px`,
          backgroundPosition: `${view.x}px ${view.y}px`,
        }}
      >
        <div
          data-plan-layer=""
          className="absolute top-0 left-0 origin-top-left"
          style={{
            width,
            height,
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`,
          }}
        >
          <PlanLayer
            {...props}
            dropTarget={drop.dropTarget}
            onDragNode={drop.startNodeDrag}
          />
        </div>
      </div>
      <PlanCanvasControls
        graph={graph}
        canEdit={props.canEdit}
        viewport={viewport}
      />
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
