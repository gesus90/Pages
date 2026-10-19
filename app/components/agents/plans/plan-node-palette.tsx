import { ChevronLeft, ChevronRight, GripVertical } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { planNodeAccent } from "./plan-layout";
import { keepPlanControlKeys } from "./plan-flow-keys";
import { PlanNodeIcon } from "./plan-node-icon";
import { PlanPaletteButton } from "./plan-palette-button";
import { PlanPaletteDialog } from "./plan-palette-dialog";

import type { PlanCanvasProps } from "./plan-flow-context";
import type {
  PlanPaletteKind,
  usePlanNodePalette,
} from "./use-plan-node-palette";

const PALETTE_KINDS: readonly PlanPaletteKind[] = [
  "start",
  "end",
  "agent",
  "parameter",
  "task",
  "group",
];

/** A local, collapsible overlay; it never changes the graph's viewport or dimensions. */
export function PlanNodePalette({
  canvas,
  palette,
}: {
  readonly canvas: PlanCanvasProps;
  readonly palette: ReturnType<typeof usePlanNodePalette>;
}): React.ReactElement {
  const { t } = useTranslation();
  const [isOpen, setOpen] = useState(true);
  const contentId = useId();
  const toggleLabel = t(
    isOpen ? "plans.palette.collapse" : "plans.palette.expand",
  );
  function toggle(event: React.MouseEvent<HTMLButtonElement>): void {
    event.currentTarget.focus({ preventScroll: true });
    setOpen(!isOpen);
  }
  const toggleButton = (
    <PlanPaletteButton
      size="icon-sm"
      variant="ghost"
      tooltip={toggleLabel}
      aria-label={toggleLabel}
      aria-expanded={isOpen}
      aria-controls={isOpen ? contentId : undefined}
      onClick={toggle}
      className={cn(
        "shrink-0",
        !isOpen &&
          "border border-border/70 bg-surface/95 shadow-xs backdrop-blur-sm",
      )}
    >
      {isOpen ? (
        <ChevronRight className="size-4" aria-hidden="true" />
      ) : (
        <ChevronLeft className="size-4" aria-hidden="true" />
      )}
    </PlanPaletteButton>
  );
  return (
    <>
      <aside
        aria-label={t("plans.palette.label")}
        data-plan-palette
        onKeyDown={keepPlanControlKeys}
        className={cn(
          "pointer-events-auto flex min-h-0 max-h-full max-w-full flex-col self-end text-foreground @5xl:self-start",
          isOpen &&
            "w-56 rounded-xl border border-border/70 bg-surface/95 p-3 shadow-floating backdrop-blur-sm",
        )}
      >
        <div
          className={cn(
            "flex shrink-0 items-center justify-between gap-2",
            isOpen && "mb-2",
          )}
        >
          {isOpen ? (
            <h2 className="min-w-0 text-base font-semibold wrap-anywhere">
              {t("plans.palette.title")}
            </h2>
          ) : null}
          {toggleButton}
        </div>
        {isOpen ? (
          <div
            id={contentId}
            className="min-h-0 space-y-2.5 overflow-y-auto p-0.5"
          >
            <PlanPaletteRows palette={palette} />
            {canvas.graph.insertionError ? (
              <p role="alert" className="pt-2 text-xs text-destructive">
                {t(`settings.agents.error.${canvas.graph.insertionError}`)}
              </p>
            ) : null}
          </div>
        ) : null}
      </aside>
      {palette.request ? (
        <PlanPaletteDialog
          key={palette.request.kind}
          request={palette.request}
          sources={canvas.sources}
          blocked={palette.blocked}
          onConfirm={palette.confirm}
          onClose={palette.close}
        />
      ) : null}
    </>
  );
}

function PlanPaletteRows({
  palette,
}: {
  readonly palette: ReturnType<typeof usePlanNodePalette>;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <>
      {PALETTE_KINDS.map((kind) => (
        <PlanPaletteButton
          key={kind}
          variant="outline"
          tooltip={[t(`plans.palette.hint.${kind}`), palette.blocked]
            .filter(Boolean)
            .join(" ")}
          aria-disabled={Boolean(palette.blocked)}
          data-plan-palette-kind={kind}
          draggable={!palette.blocked}
          onDragStart={(event) => palette.dragStart(event, kind)}
          onDragEnd={palette.dragEnd}
          onClick={() => palette.activate(kind)}
          className="h-12.5 w-full min-w-0 justify-start gap-3 rounded-lg px-3 text-sm font-medium aria-disabled:cursor-default aria-disabled:opacity-60 shadow-none xl:min-h-12.5 xl:gap-3 xl:px-3"
        >
          <PlanNodeIcon
            type={kind}
            className={cn("size-6 shrink-0", planNodeAccent(kind))}
          />
          <span className="min-w-0 flex-1 truncate text-left">
            {t(`plans.palette.type.${kind}`)}
          </span>
          <GripVertical
            className="size-4 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
        </PlanPaletteButton>
      ))}
    </>
  );
}
