import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import { ScrollViewport } from "@/app/components/ui/scroll-viewport";
import { cn } from "@/app/lib/cn";

import { PlanPaletteButton } from "./plan-palette-button";
import { statusTone } from "./plan-run-status-model";
import { hasOpenPlanReport, planStatusKey } from "./plan-status";

import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";

interface StatusSequenceProps {
  readonly run: AgentPlanRun;
  readonly steps: readonly AgentPlanStepResult[];
  readonly anchorId: string | null;
  readonly selectedId: string | null;
  readonly onSelect: (id: string) => void;
}

/** Scrolls the sequence so the anchor step sits in the middle of the visible window. */
function centerAnchor(element: HTMLElement, anchorId: string | null): void {
  const entries = Array.from(
    element.querySelectorAll<HTMLElement>("[data-status-step]"),
  );
  const anchorIndex = entries.findIndex(
    (entry) => entry.dataset.statusStep === anchorId,
  );
  const first = entries[0];
  if (!first || anchorIndex < 0) return;
  const stride = Math.max(
    1,
    entries[1] ? entries[1].offsetLeft - first.offsetLeft : first.offsetWidth,
  );
  const capacity = Math.max(
    1,
    Math.floor((element.clientWidth - first.offsetWidth) / stride) + 1,
  );
  // At least one step stays visible, so the start index always names a step.
  const startIndex = Math.max(
    0,
    Math.min(anchorIndex - Math.floor(capacity / 2), entries.length - capacity),
  );
  element.scrollLeft = Math.max(
    0,
    Math.min(
      element.scrollWidth - element.clientWidth,
      entries[startIndex].offsetLeft,
    ),
  );
}

/** A bounded, keyboard-scrollable sequence; progress moves this window alone. */
export function PlanStatusSequence({
  run,
  steps,
  anchorId,
  selectedId,
  onSelect,
}: StatusSequenceProps): React.ReactElement {
  const { t } = useTranslation();
  const viewport = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const center = (): void => centerAnchor(element, anchorId);
    center();
    const observer = new ResizeObserver(center);
    observer.observe(element);
    return () => observer.disconnect();
  }, [anchorId, run.id, steps.length]);
  return (
    <div className="min-w-0 flex-1 px-2">
      <ScrollViewport
        axis="horizontal"
        ref={viewport}
        role="group"
        aria-label={t("plans.progress.sequence")}
        containerClassName="relative"
        className="flex -space-x-1 gap-0.75 overflow-x-auto"
      >
        {steps.map((step, index) => {
          const label = `${index + 1} · ${step.name} · ${t(planStatusKey(step.status, step.isBlocked, hasOpenPlanReport(step)))}`;
          return (
            <PlanPaletteButton
              key={step.id}
              type="button"
              data-status-step={step.id}
              aria-label={label}
              title={label}
              tooltip={label}
              wrapperClassName="shrink-0"
              aria-pressed={selectedId === step.id}
              onClick={() => onSelect(step.id)}
              className={cn(
                "relative h-7.5 min-h-7.5 w-11 shrink-0 cursor-pointer rounded-none p-0 xl:min-h-7.5 xl:p-0 xl:text-xs [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:w-14 [clip-path:polygon(0_0,74%_0,100%_50%,74%_100%,0_100%,25%_50%)] text-xs font-bold tabular-nums after:absolute after:inset-0 hover:brightness-110 focus-visible:outline-none focus-visible:after:border-y-4 focus-visible:after:border-ring",
                statusTone(step, run),
                selectedId === step.id &&
                  "after:border-y-2 after:border-foreground/60",
              )}
            >
              <span className="relative z-1 pl-1">{index + 1}</span>
            </PlanPaletteButton>
          );
        })}
      </ScrollViewport>
    </div>
  );
}
