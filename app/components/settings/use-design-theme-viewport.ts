import { useLayoutEffect, useRef, useState } from "react";

import type { RefObject } from "react";

/** Cards the design picker shows completely before it scrolls. */
export const VISIBLE_DESIGN_CARD_COUNT = 4;

/** Height of the next row that shows below the complete cards, in CSS pixels. */
const NEXT_ROW_PEEK = 30;

/** The scroll area of the design picker and the height it is limited to. */
export interface DesignThemeViewport {
  readonly gridRef: RefObject<HTMLDivElement | null>;
  readonly viewportRef: RefObject<HTMLElement | null>;
  /** Measured height in CSS pixels; `null` until the cards were measured. */
  readonly maxHeight: number | null;
}

/**
 * The height that shows four complete cards and a little of the next row.
 *
 * @remarks
 * The fifth card starts the next row in the two-column and in the
 * one-column layout, so its distance from the top of the grid is the height
 * of four complete cards whatever their texts are.
 */
function measureVisibleHeight(
  viewport: HTMLElement,
  grid: HTMLElement,
): number | null {
  const firstHiddenCard = grid.children.item(VISIBLE_DESIGN_CARD_COUNT);

  if (!firstHiddenCard) {
    return null;
  }

  // Measured from the viewport, so its inner padding counts and the current
  // scroll position does not.
  const offset =
    firstHiddenCard.getBoundingClientRect().top -
    viewport.getBoundingClientRect().top +
    viewport.scrollTop;

  return Math.ceil(offset + NEXT_ROW_PEEK);
}

/**
 * Scrolls only the picker, never the page, until the chosen card is complete.
 *
 * @remarks
 * A card in a later row ends one row gap and the peek above the lower edge,
 * so the fade of the edge does not cover it; the last row ends at the edge.
 */
function revealChosenCard(viewport: HTMLElement, grid: HTMLElement): void {
  const card = grid.querySelector('[aria-pressed="true"]');

  if (!card) {
    return;
  }

  const viewportBox = viewport.getBoundingClientRect();
  const cardBox = card.getBoundingClientRect();
  const cardBottom = cardBox.bottom - viewportBox.top + viewport.scrollTop;

  if (cardBottom <= viewport.clientHeight) {
    return;
  }

  const rowGap = Number.parseFloat(getComputedStyle(grid).rowGap) || 0;

  viewport.scrollTop =
    cardBottom - viewport.clientHeight + rowGap + NEXT_ROW_PEEK;
}

/**
 * Limits the design picker to four complete cards and shows the chosen one.
 *
 * @param cardCount - Number of offered designs; up to four need no scroll area.
 * @returns Refs for the grid and the native scroll viewport, and the height.
 *
 * @remarks
 * The height follows the real cards: it is measured again whenever the grid
 * changes its size, for example at the breakpoint of the second column or
 * with longer texts. The chosen card is revealed once, when the picker opens.
 */
export function useDesignThemeViewport(cardCount: number): DesignThemeViewport {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLElement | null>(null);
  const hasRevealed = useRef(false);
  const [maxHeight, setMaxHeight] = useState<number | null>(null);
  const isScrollable = cardCount > VISIBLE_DESIGN_CARD_COUNT;

  useLayoutEffect(() => {
    const grid = gridRef.current;
    const viewport = viewportRef.current;

    if (!isScrollable || !grid || !viewport) {
      return;
    }

    function measure(): void {
      if (grid && viewport) {
        setMaxHeight(measureVisibleHeight(viewport, grid));
      }
    }

    measure();
    const observer = new ResizeObserver(measure);

    observer.observe(grid);

    return () => observer.disconnect();
  }, [isScrollable]);

  useLayoutEffect(() => {
    const grid = gridRef.current;
    const viewport = viewportRef.current;

    if (maxHeight === null || hasRevealed.current || !grid || !viewport) {
      return;
    }

    hasRevealed.current = true;
    revealChosenCard(viewport, grid);
  }, [maxHeight]);

  return { gridRef, viewportRef, maxHeight };
}
