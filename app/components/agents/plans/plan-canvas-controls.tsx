import { Maximize, Minus, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";

import type { PlanGraphActions } from "./use-plan-graph";
import type { PlanViewport } from "./use-plan-viewport";

// Relative change of one zoom button press.
const ZOOM_STEP = 1.25;

/** Boundary nodes and zoom buttons float over the bottom of the grid, where plans rarely begin. */
export function PlanCanvasControls(props: {
  readonly graph: PlanGraphActions;
  readonly canEdit: boolean;
  readonly viewport: PlanViewport;
}): React.ReactElement {
  const { t } = useTranslation();
  const { graph, viewport } = props;
  return (
    <div className="pointer-events-none absolute bottom-2 left-2 z-10 flex max-w-[calc(100%-1rem)] flex-col items-start gap-2">
      {graph.connection ? (
        <div
          role="status"
          className="pointer-events-auto flex items-center gap-2 rounded-lg border border-border bg-surface p-1 pl-3 text-sm shadow-xs"
        >
          {t("plans.connectHint")}
          <Button size="sm" variant="ghost" onClick={() => graph.begin(null)}>
            {t("settings.agents.cancel")}
          </Button>
        </div>
      ) : null}
      <div className="pointer-events-auto flex flex-wrap items-center gap-1 rounded-lg border border-border bg-surface p-1 shadow-xs">
        <Button
          size="sm"
          variant="outline"
          disabled={!props.canEdit}
          onClick={() => graph.add("start", "start")}
        >
          {t("plans.addStart")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!props.canEdit}
          onClick={() => graph.add("end", "end")}
        >
          {t("plans.addEnd")}
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={t("plans.zoomOut")}
          onClick={() => viewport.zoomBy(1 / ZOOM_STEP)}
        >
          <Minus className="size-4" aria-hidden="true" />
        </Button>
        <output
          aria-label={t("plans.zoomLevel")}
          className="min-w-12 text-center text-xs tabular-nums"
        >
          {Math.round(viewport.view.zoom * 100)} %
        </output>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={t("plans.zoomIn")}
          onClick={() => viewport.zoomBy(ZOOM_STEP)}
        >
          <Plus className="size-4" aria-hidden="true" />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={t("plans.resetView")}
          onClick={viewport.reset}
        >
          <Maximize className="size-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
