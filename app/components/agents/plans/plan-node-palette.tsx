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
        "size-8 min-h-8 shrink-0 rounded-md p-0 xl:size-8 xl:min-h-8 xl:p-0 [@media(pointer:coarse)]:size-11 [@media(pointer:coarse)]:min-h-11",
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
            "w-44 shrink-0 rounded-lg border border-border bg-surface/95 p-2 shadow-floating backdrop-blur-sm",
        )}
      >
        <div
          className={cn(
            "flex shrink-0 items-center justify-between gap-2",
            isOpen && "mb-1.5 min-h-8",
          )}
        >
          {isOpen ? (
            <h2 className="min-w-0 text-xs leading-4.5 font-semibold wrap-anywhere">
              {t("plans.palette.title")}
            </h2>
          ) : null}
          {toggleButton}
        </div>
        {isOpen ? (
          <div
            id={contentId}
            className="flex min-h-0 flex-col gap-1 overflow-y-auto overscroll-contain"
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
          className="h-8 min-h-8 w-full min-w-0 justify-start gap-2 rounded-md px-2 text-xs leading-4.5 font-medium aria-disabled:cursor-default aria-disabled:opacity-60 shadow-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none xl:min-h-8 xl:gap-2 xl:px-2 xl:text-xs [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:min-h-11"
        >
          <PlanNodeIcon
            type={kind}
            className={cn("size-4.5 shrink-0", planNodeAccent(kind))}
          />
          <span className="min-w-0 flex-1 truncate text-left">
            {t(`plans.palette.type.${kind}`)}
          </span>
          <GripVertical
            className="size-3 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
        </PlanPaletteButton>
      ))}
    </>
  );
}
