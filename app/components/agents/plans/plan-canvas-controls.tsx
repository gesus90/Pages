import { CircleHelp, Maximize, Minus, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";

import type { PlanGraphActions } from "./use-plan-graph";
import type { PlanViewport } from "./use-plan-viewport";

// Relative change of one zoom button press.
const ZOOM_STEP = 1.25;

/**
 * Boundary nodes, zoom buttons and the grid help float at the left edge of the grid.
 *
 * @remarks
 * The middle of the left edge stays clear of the configuration bar above and
 * the run details below, so the controls stay reachable with both panels open.
 */
export function PlanCanvasControls(props: {
  readonly graph: PlanGraphActions;
  readonly canEdit: boolean;
  readonly viewport: PlanViewport;
}): React.ReactElement {
  const { t } = useTranslation();
  const { graph, viewport } = props;
  return (
    <>
      {graph.connection ? (
        <div
          role="status"
          className="absolute top-2 left-1/2 z-[5] flex max-w-[calc(100%-1rem)] -translate-x-1/2 items-center gap-2 rounded-lg border border-border bg-surface p-1 pl-3 text-sm shadow-xs xl:top-36"
        >
          {t("plans.connectHint")}
          <Button size="sm" variant="ghost" onClick={() => graph.begin(null)}>
            {t("settings.agents.cancel")}
          </Button>
        </div>
      ) : null}
      <div className="absolute top-1/2 left-2 z-[5] flex -translate-y-1/2 flex-col items-stretch gap-1 rounded-lg border border-border bg-surface/95 p-1 shadow-xs">
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
          className="self-center"
          aria-label={t("plans.zoomIn")}
          onClick={() => viewport.zoomBy(ZOOM_STEP)}
        >
          <Plus className="size-4" aria-hidden="true" />
        </Button>
        <output
          aria-label={t("plans.zoomLevel")}
          className="text-center text-xs tabular-nums"
        >
          {Math.round(viewport.view.zoom * 100)} %
        </output>
        <Button
          size="icon-sm"
          variant="ghost"
          className="self-center"
          aria-label={t("plans.zoomOut")}
          onClick={() => viewport.zoomBy(1 / ZOOM_STEP)}
        >
          <Minus className="size-4" aria-hidden="true" />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          className="self-center"
          aria-label={t("plans.resetView")}
          onClick={viewport.reset}
        >
          <Maximize className="size-4" aria-hidden="true" />
        </Button>
        <details className="relative self-center">
          <summary
            className="flex size-8 cursor-pointer list-none items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={t("plans.canvasHelp")}
            title={t("plans.canvasHelp")}
          >
            <CircleHelp className="size-4" aria-hidden="true" />
          </summary>
          <p className="absolute top-0 left-10 w-72 rounded-lg border border-border bg-surface p-3 text-xs text-muted-foreground shadow-floating">
            {t("plans.canvasHint")}
          </p>
        </details>
      </div>
    </>
  );
}
