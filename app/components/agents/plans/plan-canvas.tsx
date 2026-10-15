import { useTranslation } from "react-i18next";

import { PlanCanvasControls } from "./plan-canvas-controls";
import { PlanEdges } from "./plan-edges";
import { PlanLinkAction } from "./plan-link-action";
import { PlanNodeCard } from "./plan-node-card";
import { PLAN_GRID, PLAN_NODE_WIDTH, planNodeHeight } from "./plan-layout";
import { usePlanViewport } from "./use-plan-viewport";

import type {
  AgentPlanInput,
  AgentPlanSources,
  AgentPlanRun,
} from "@/definition/AgentPlan";
import type { PlanGraphActions } from "./use-plan-graph";

// Keys that delete the selected node or connection while the grid has focus.
const DELETE_KEYS = new Set(["Delete", "Backspace"]);

/**
 * The plan grid fills its area; dragging the empty grid pans it and the mouse wheel zooms it.
 *
 * @remarks
 * Nodes and connections share one transformed layer, so they keep their
 * positions relative to each other at every offset and zoom level.
 */
export function PlanCanvas(props: {
  readonly draft: AgentPlanInput;
  readonly sources: AgentPlanSources;
  readonly graph: PlanGraphActions;
  readonly canEdit: boolean;
  readonly run: AgentPlanRun | null;
  readonly onEdit?: (id: string) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const { graph } = props;
  const viewport = usePlanViewport(() => graph.select(null));
  const { view } = viewport;
  const width = Math.max(
    1000,
    ...props.draft.nodes.map((node) => node.x + PLAN_NODE_WIDTH + 100),
  );
  const height = Math.max(
    500,
    ...props.draft.nodes.map(
      (node) => node.y + planNodeHeight(node, props.sources) + 100,
    ),
  );
  function drop(event: React.DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    if (!props.canEdit) return;
    const [kind, reference] = event.dataTransfer
      .getData("application/x-pages-plan")
      .split(":");
    if (!reference) return;
    const position = viewport.toGrid(event.clientX, event.clientY);
    if (kind === "node") graph.move(reference, position.x, position.y);
    if (kind === "agent" || kind === "task" || kind === "variable")
      graph.add(kind, reference, position);
  }
  function deleteSelection(event: React.KeyboardEvent<HTMLDivElement>): void {
    const { selectedLink, selectedId } = graph;
    if (!props.canEdit || !DELETE_KEYS.has(event.key)) return;
    if (!selectedLink && !selectedId) return;
    event.preventDefault();
    if (selectedLink) graph.disconnect(selectedLink);
    if (selectedId) graph.remove(selectedId);
  }
  return (
    <section aria-label={t("plans.canvas")} className="absolute inset-0">
      <div
        ref={viewport.viewportRef}
        role="region"
        aria-label={t("plans.grid")}
        tabIndex={0}
        onDragOver={(event) => event.preventDefault()}
        onDrop={drop}
        onKeyDown={deleteSelection}
        {...viewport.pointer}
        className="relative size-full cursor-grab touch-none overflow-hidden bg-surface bg-[radial-gradient(var(--color-border)_1px,transparent_1px)] outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset active:cursor-grabbing"
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
          <PlanEdges
            plan={props.draft}
            sources={props.sources}
            selected={graph.selectedLink}
            onSelect={graph.selectLink}
          />
          {props.draft.nodes.map((node) => (
            <PlanNodeCard
              key={node.id}
              node={node}
              {...props}
              result={props.run?.steps.find((step) => step.id === node.id)}
            />
          ))}
          <PlanLinkAction
            draft={props.draft}
            sources={props.sources}
            graph={graph}
            canEdit={props.canEdit}
          />
        </div>
      </div>
      <PlanCanvasControls
        graph={graph}
        canEdit={props.canEdit}
        viewport={viewport}
      />
    </section>
  );
}
