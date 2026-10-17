import { Controls, MiniMap, Panel, useViewport } from "@xyflow/react";
import { CircleHelp, LockKeyhole, MousePointer2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import reactFlowLicense from "@/assets/react-flow-LICENSE.txt?url";
import { Button } from "@/app/components/ui/button";

import { usePlanFlowContext } from "./plan-flow-context";

import type { PlanFlowNode } from "./plan-flow-model";

function minimapColor(node: PlanFlowNode): string {
  const colors = {
    agent: "var(--color-plan-agent)",
    group: "var(--color-plan-group-subtle)",
    task: "var(--color-plan-ticket)",
    parameter: "var(--color-plan-parameter)",
    variable: "var(--color-plan-parameter)",
    start: "var(--color-muted-foreground)",
    end: "var(--color-muted-foreground)",
  };
  return colors[node.data.node.type];
}

function canvasMode(options: {
  readonly isReadOnly: boolean;
  readonly canEdit: boolean;
  readonly hasWorkspace: boolean;
}): string {
  if (options.isReadOnly) return "plans.flow.readOnly";
  if (!options.hasWorkspace) return "plans.flow.chooseWorkspace";
  return options.canEdit ? "plans.flow.editable" : "plans.flow.busy";
}

/** Native React Flow controls, viewport overview and a compact legend share the Pages palette. */
export function PlanCanvasControls(): React.ReactElement {
  const { t } = useTranslation();
  const { graph, draft, canEdit, isReadOnly, cancelConnection } =
    usePlanFlowContext();
  const viewport = useViewport();
  const hasReadOnlyAccess = isReadOnly ?? !canEdit;
  const ModeIcon = hasReadOnlyAccess ? LockKeyhole : MousePointer2;
  const mode = canvasMode({
    isReadOnly: hasReadOnlyAccess,
    canEdit,
    hasWorkspace: Boolean(draft.workspaceId),
  });
  return (
    <>
      <Panel position="top-left" className="max-w-[calc(100%-6rem)] space-y-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-border bg-surface/95 px-3 py-2 text-xs shadow-xs backdrop-blur">
          <span className="flex items-center gap-1.5 font-medium">
            <ModeIcon className="size-3.5" aria-hidden="true" />
            {t(mode)}
          </span>
          <span className="text-muted-foreground">
            → {t("plans.linkKind.flow")}
          </span>
          <span className="text-muted-foreground">
            ┄ ◇ {t("plans.linkKind.data")}
          </span>
        </div>
        {graph.connection ? (
          <div
            role="status"
            className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface p-2 text-xs shadow-xs"
          >
            {t("plans.connectHint")}
            <Button size="xs" variant="ghost" onClick={cancelConnection}>
              {t("settings.agents.cancel")}
            </Button>
          </div>
        ) : null}
      </Panel>
      <Controls
        position="bottom-left"
        orientation="horizontal"
        showInteractive={false}
        fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
        aria-label={t("plans.flow.tools")}
      >
        <output
          aria-label={t("plans.zoomLevel")}
          className="flex min-w-14 items-center justify-center px-2 text-xs tabular-nums"
        >
          {Math.round(viewport.zoom * 100)} %
        </output>
      </Controls>
      <MiniMap<PlanFlowNode>
        position="bottom-right"
        pannable
        zoomable
        nodeColor={minimapColor}
        nodeStrokeColor="var(--color-border)"
        nodeStrokeWidth={2}
        maskColor="color-mix(in srgb, var(--color-background) 75%, transparent)"
        maskStrokeColor="var(--color-info)"
        ariaLabel={t("plans.flow.miniMap")}
        className="hidden overflow-hidden rounded-xl border border-border shadow-xs sm:block"
        style={{ width: 144, height: 96 }}
      />
      <Panel position="top-right">
        <details className="relative">
          <summary
            className="flex size-9 cursor-pointer list-none items-center justify-center rounded-lg border border-border bg-surface text-muted-foreground shadow-xs focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={t("plans.canvasHelp")}
            title={t("plans.canvasHelp")}
          >
            <CircleHelp className="size-4" aria-hidden="true" />
          </summary>
          <div className="absolute top-11 right-0 w-64 space-y-2 rounded-xl border border-border bg-surface p-3 text-xs text-muted-foreground shadow-floating sm:w-80">
            <p>{t("plans.canvasHint")}</p>
            <a
              href={reactFlowLicense}
              target="_blank"
              rel="noreferrer"
              className="text-primary-text underline focus-visible:ring-2 focus-visible:ring-ring"
            >
              React Flow · MIT
            </a>
          </div>
        </details>
      </Panel>
    </>
  );
}
