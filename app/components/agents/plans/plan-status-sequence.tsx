import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { PlanPaletteButton } from "./plan-palette-button";
import { statusTone } from "./plan-run-status-model";
import {
  hasOpenPlanReport,
  isQueuedPlanStep,
  planStatusKey,
} from "./plan-status";

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
  "[clip-path:polygon(0_0,calc(100%_-_10px)_0,100%_50%,calc(100%_-_10px)_100%,0_100%,10px_50%)]";

/** The first block starts at a straight edge rather than an inset notch. */
export const SEQUENCE_FIRST_CHEVRON =
  "[clip-path:polygon(0_0,calc(100%_-_10px)_0,100%_50%,calc(100%_-_10px)_100%,0_100%)]";

/** Content determines width while the padding keeps numbers clear of the cutout. */
export const SEQUENCE_BLOCK_SIZE =
  "h-7.5 min-h-7.5 min-w-11 shrink-0 py-0 pr-3.5 pl-4 xl:min-h-7.5 xl:py-0 xl:pr-3.5 xl:pl-4 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-14";

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
  const anchor = Array.from(
    element.querySelectorAll<HTMLElement>("[data-status-step]"),
  ).find((entry) => entry.dataset.statusStep === anchorKey);
  if (!anchor) return;
  element.scrollLeft = Math.max(
    0,
    Math.min(
      element.scrollWidth - element.clientWidth,
      anchor.offsetLeft + anchor.offsetWidth / 2 - element.clientWidth / 2,
    ),
  );
}

/** Masks only edges beyond which further steps remain, without covering their colors. */
function sequenceMask(element: HTMLElement): string {
  if (element.scrollWidth <= element.clientWidth) return "none";
  const hasLeft = element.scrollLeft > 0;
  const hasRight =
    element.scrollLeft + element.clientWidth < element.scrollWidth;
  if (!hasLeft && !hasRight) return "none";
  const left = hasLeft ? "transparent, currentColor 28px" : "currentColor";
  const right = hasRight
    ? "currentColor calc(100% - 28px), transparent"
    : "currentColor";
  return `linear-gradient(to right, ${left}, ${right})`;
}

/** Allows an ordinary mouse wheel to move the horizontal row, releasing it at either end. */
function scrollSequence(element: HTMLElement, event: WheelEvent): void {
  if (
    event.ctrlKey ||
    event.shiftKey ||
    Math.abs(event.deltaX) >= Math.abs(event.deltaY)
  )
    return;
  let distance = event.deltaY;
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE)
    distance *=
      parseFloat(getComputedStyle(element).lineHeight) || element.clientHeight;
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE)
    distance *= element.clientWidth;
  const previous = element.scrollLeft;
  element.scrollLeft += distance;
  if (element.scrollLeft !== previous) event.preventDefault();
}

/** Keeps masks and centering in sync with scrolling, labels, fonts and viewport sizes. */
function observeSequence(
  element: HTMLElement,
  anchorKey: string | null,
): () => void {
  const updateMask = (): void => {
    element.style.maskImage = sequenceMask(element);
  };
  const center = (): void => {
    centerAnchor(element, anchorKey);
    updateMask();
  };
  const wheel = (event: WheelEvent): void => scrollSequence(element, event);
  const resize = new ResizeObserver(center);
  function observeContent(): void {
    resize.disconnect();
    resize.observe(element);
    for (const child of element.children) resize.observe(child);
    center();
  }
  const content = new MutationObserver(observeContent);
  content.observe(element, { childList: true });
  element.addEventListener("scroll", updateMask, { passive: true });
  element.addEventListener("wheel", wheel, { passive: false });
  observeContent();
  return () => {
    resize.disconnect();
    content.disconnect();
    element.removeEventListener("scroll", updateMask);
    element.removeEventListener("wheel", wheel);
  };
}

function keepSequenceScrollKeys(
  event: React.KeyboardEvent<HTMLDivElement>,
): void {
  if (
    ["ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"].includes(
      event.key,
    )
  )
    event.stopPropagation();
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
    <span
      aria-hidden="true"
      className="relative z-1 flex shrink-0 items-baseline whitespace-nowrap"
    >
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
    return observeSequence(element, selectedKey ?? anchorKey);
  }, [anchorKey, selectedKey, run?.id, blocks.length]);
  return (
    <div className="min-w-0 flex-1 px-2">
      <div
        ref={viewport}
        role="group"
        tabIndex={0}
        aria-label={t("plans.progress.sequence")}
        onKeyDown={keepSequenceScrollKeys}
        className="relative flex min-w-0 -space-x-1.5 gap-0.75 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
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
                "relative cursor-pointer rounded-none text-xs font-bold tabular-nums xl:text-xs after:absolute after:inset-0 hover:brightness-110 focus-visible:outline-none focus-visible:after:border-y-4 focus-visible:after:border-ring",
                SEQUENCE_BLOCK_SIZE,
                index === 0 ? SEQUENCE_FIRST_CHEVRON : SEQUENCE_CHEVRON,
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
      </div>
    </div>
  );
}
