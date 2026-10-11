import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { HorizontalScrollArea } from "@/app/components/ui/horizontal-scroll-area";

import { PlanEdges } from "./plan-edges";
import { PlanNodeCard } from "./plan-node-card";
import { PLAN_GRID, PLAN_NODE_WIDTH, planNodeHeight } from "./plan-layout";

import type { AgentPlanInput, AgentPlanSources } from "@/definition/AgentPlan";
import type { PlanGraphActions } from "./use-plan-graph";

/** A native, SSR-compatible grid with persisted positions and existing Pages scroll behavior. */
export function PlanCanvas(props: {
  readonly draft: AgentPlanInput;
  readonly sources: AgentPlanSources;
  readonly graph: PlanGraphActions;
  readonly canEdit: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
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
    const bounds = event.currentTarget.getBoundingClientRect();
    const position = {
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    };
    if (kind === "node") props.graph.move(reference, position.x, position.y);
    if (kind === "agent" || kind === "task" || kind === "variable")
      props.graph.add(kind, reference, position);
  }
  return (
    <section aria-label={t("plans.canvas")} className="space-y-2">
      <p className="text-sm text-muted-foreground">{t("plans.canvasHint")}</p>
      {props.graph.connection ? (
        <div role="status" className="flex items-center gap-2 text-sm">
          {t("plans.connectHint")}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => props.graph.begin(null)}
          >
            {t("settings.agents.cancel")}
          </Button>
        </div>
      ) : null}
      <HorizontalScrollArea
        className="rounded-xl border border-border"
        viewportClassName="max-h-[65vh] overflow-y-auto"
      >
        <div
          role="region"
          aria-label={t("plans.grid")}
          onDragOver={(event) => event.preventDefault()}
          onDrop={drop}
          className="relative bg-surface bg-[radial-gradient(var(--color-border)_1px,transparent_1px)]"
          style={{
            width,
            height,
            backgroundSize: `${PLAN_GRID}px ${PLAN_GRID}px`,
          }}
        >
          <PlanEdges plan={props.draft} sources={props.sources} />
          {props.draft.nodes.map((node) => (
            <PlanNodeCard
              key={node.id}
              node={node}
              sources={props.sources}
              graph={props.graph}
              canEdit={props.canEdit}
            />
          ))}
        </div>
      </HorizontalScrollArea>
    </section>
  );
}
