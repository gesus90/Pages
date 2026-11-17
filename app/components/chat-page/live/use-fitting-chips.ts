import { useLayoutEffect, useRef, useState } from "react";

import type { RefObject } from "react";

/** The space between two chips of the status line, `gap-2`. */
const CHIP_GAP_PX = 8;

/** The elements the line measures and how many chips it shows. */
interface FittingChips {
  /** The visible line; its width is the room for the chips. */
  readonly row: RefObject<HTMLUListElement | null>;
  /** A hidden copy of every chip and of the chip "+N" at their natural width. */
  readonly measurer: RefObject<HTMLDivElement | null>;
  /** How many chips stand in the line, at least one while there are any. */
  readonly visibleCount: number;
}

/**
 * How many chips fit next to each other, given their natural widths, the
 * room of the line and the chip "+N" that follows when not all fit.
 * @param widths - The natural widths of the chips, in their order.
 * @param plusWidth - The natural width of the chip "+N".
 * @param available - The width of the line.
 * @returns At least one, so the first chip always shows, truncated if need be.
 */
export function fittingChipCount(
  widths: readonly number[],
  plusWidth: number,
  available: number,
): number {
  let used = 0;
  let count = 0;
  for (const [index, width] of widths.entries()) {
    const next = used + (index === 0 ? 0 : CHIP_GAP_PX) + width;
    const isLast = index === widths.length - 1;
    const reserve = isLast ? 0 : CHIP_GAP_PX + plusWidth;
    if (next + reserve > available) break;
    used = next;
    count = index + 1;
  }
  return Math.min(widths.length, Math.max(1, count));
}

/**
 * Measures the chips of the status line and keeps the number that fits in
 * one line, again whenever the line changes its width or the chips change.
 * @param contentKey - Changes whenever the text of a chip changes.
 * @returns The refs to set and the number of chips to show.
 */
export function useFittingChips(contentKey: string): FittingChips {
  const row = useRef<HTMLUListElement | null>(null);
  const measurer = useRef<HTMLDivElement | null>(null);
  const [visibleCount, setVisibleCount] = useState(Number.POSITIVE_INFINITY);

  useLayoutEffect(() => {
    const line = row.current;
    const copies = measurer.current;
    if (!line || !copies) return undefined;
    function measure(): void {
      if (!line || !copies) return;
      const items = [...copies.children].filter(
        (element): element is HTMLElement => element instanceof HTMLElement,
      );
      const plus = items.pop();
      const widths = items.map((element) => element.offsetWidth);
      setVisibleCount(
        fittingChipCount(widths, plus?.offsetWidth ?? 0, line.clientWidth),
      );
    }
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(line);
    return () => observer.disconnect();
  }, [contentKey]);

  return { row, measurer, visibleCount };
}
