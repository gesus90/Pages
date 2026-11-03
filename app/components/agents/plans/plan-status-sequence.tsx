import { isQueuedPlanStep } from "./plan-status";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import { ScrollViewport } from "@/app/components/ui/scroll-viewport";
import { cn } from "@/app/lib/cn";

import { PlanPaletteButton } from "./plan-palette-button";
import { statusTone } from "./plan-run-status-model";
import { hasOpenPlanReport, planStatusKey } from "./plan-status";

import type { TFunction } from "i18next";
import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { PlanSequenceBlock } from "./plan-step-sequence";

interface StatusSequenceProps {
  readonly run: AgentPlanRun | null;
  readonly blocks: readonly PlanSequenceBlock[];
  readonly anchorKey: string | null;
  readonly selectedKey: string | null;
  readonly onSelect: (key: string) => void;
}

/** The chevron of every block, shared by the run sequence and the plan outlook. */
export const SEQUENCE_CHEVRON =
  "[clip-path:polygon(0_0,74%_0,100%_50%,74%_100%,0_100%,25%_50%)]";

/** A planned block is the waiting tone; an assumed one is hatched, so it never reads as a fact. */
const OUTLOOK_TONES = {
  planned:
    "bg-plan-progress-waiting text-foreground hover:bg-plan-progress-waiting",
  assumed:
    "bg-[repeating-linear-gradient(135deg,var(--color-plan-progress-waiting)_0_4px,transparent_4px_8px)] bg-surface-hover text-muted-foreground italic hover:bg-surface-hover",
} as const;

/** The fill of a block: the state of its record, or the certainty of its outlook. */
export function sequenceTone(
  block: PlanSequenceBlock,
  run: AgentPlanRun | null,
): string {
  if (block.kind === "assumed") return OUTLOOK_TONES.assumed;
  return block.result && run
    ? statusTone(block.result, run)
    : OUTLOOK_TONES.planned;
}

/** Whether the block's pass is worth naming: a loop iteration, or a node that starts more than once. */
export function showsPass(
  block: PlanSequenceBlock,
  blocks: readonly PlanSequenceBlock[],
): boolean {
  return (
    block.isLoopPass ||
    block.pass > 1 ||
    blocks.some(
      (entry) => entry.nodeId === block.nodeId && entry.key !== block.key,
    )
  );
}

/** What a block states: its record's status, or that it is planned or assumed. */
function blockState(block: PlanSequenceBlock, translate: TFunction): string {
  if (block.kind === "assumed") return translate("plans.progress.assumed");
  const step = block.result;
  // A waiting record states no more than the plan: the block has not started.
  if (!step || (step.status === "waiting" && !step.isBlocked))
    return translate("plans.progress.planned");
  return translate(
    isQueuedPlanStep(step)
      ? "plans.status.queued"
      : planStatusKey(step.status, step.isBlocked, hasOpenPlanReport(step)),
  );
}

/**
 * The accessible name of a block: number, name, pass and state.
 *
 * @param block - The block.
 * @param options - Its number, whether its pass is named, and the translation.
 */
export function blockLabel(
  block: PlanSequenceBlock,
  options: {
    readonly number: number;
    readonly hasPass: boolean;
    readonly translate: TFunction;
  },
): string {
  const { number, hasPass, translate } = options;
  return [
    String(number),
    block.name,
    hasPass ? translate("plans.progress.pass", { pass: block.pass }) : null,
    blockState(block, translate),
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Scrolls the sequence so the anchor step sits in the middle of the visible window. */
function centerAnchor(element: HTMLElement, anchorKey: string | null): void {
  const entries = Array.from(
    element.querySelectorAll<HTMLElement>("[data-status-step]"),
  );
  const anchorIndex = entries.findIndex(
    (entry) => entry.dataset.statusStep === anchorKey,
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

/** The number of a block and, for a repeated execution, its pass. */
export function BlockNumber({
  number,
  pass,
}: {
  readonly number: number;
  readonly pass: number | null;
}): React.ReactElement {
  return (
    <span aria-hidden="true" className="relative z-1 flex items-baseline pl-1">
      {number}
      {pass === null ? null : (
        <span className="ml-px text-[0.5625rem] leading-none font-semibold opacity-80">
          ↻{pass}
        </span>
      )}
    </span>
  );
}

/** A bounded, keyboard-scrollable sequence; progress moves this window alone. */
export function PlanStatusSequence({
  run,
  blocks,
  anchorKey,
  selectedKey,
  onSelect,
}: StatusSequenceProps): React.ReactElement {
  const { t } = useTranslation();
  const viewport = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const center = (): void => centerAnchor(element, selectedKey ?? anchorKey);
    center();
    const observer = new ResizeObserver(center);
    observer.observe(element);
    return () => observer.disconnect();
  }, [anchorKey, selectedKey, run?.id, blocks.length]);
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
        {blocks.map((block, index) => {
          const hasPass = showsPass(block, blocks);
          const label = blockLabel(block, {
            number: index + 1,
            hasPass,
            translate: t,
          });
          return (
            <PlanPaletteButton
              key={block.key}
              type="button"
              data-status-step={block.key}
              data-sequence-kind={block.kind}
              aria-label={label}
              title={label}
              tooltip={label}
              wrapperClassName="shrink-0"
              aria-pressed={selectedKey === block.key}
              onClick={() => onSelect(block.key)}
              className={cn(
                "relative h-7.5 min-h-7.5 w-11 shrink-0 cursor-pointer rounded-none p-0 xl:min-h-7.5 xl:p-0 xl:text-xs [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:w-14 text-xs font-bold tabular-nums after:absolute after:inset-0 hover:brightness-110 focus-visible:outline-none focus-visible:after:border-y-4 focus-visible:after:border-ring",
                SEQUENCE_CHEVRON,
                sequenceTone(block, run),
                selectedKey === block.key &&
                  "after:border-y-2 after:border-foreground/60",
              )}
            >
              <BlockNumber
                number={index + 1}
                pass={hasPass ? block.pass : null}
              />
            </PlanPaletteButton>
          );
        })}
      </ScrollViewport>
    </div>
  );
}
