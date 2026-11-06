import { useState } from "react";

/** Rows drawn beyond each edge of the viewport, so fast scrolling shows no gap. */
const OVERSCAN_ROWS = 4;

interface VirtualRowsOptions {
  readonly count: number;
  /** Height of every row in pixels; all rows share it. */
  readonly rowHeight: number;
  /** Height of the scrolling viewport in pixels. */
  readonly viewportHeight: number;
}

/** The rows a list draws now and how it follows the scroll position. */
export interface VirtualRows {
  /** Index of the first drawn row. */
  readonly start: number;
  /** Index after the last drawn row. */
  readonly end: number;
  /** Height of all rows together, which keeps the scroll bar true to the list. */
  readonly totalHeight: number;
  readonly onScroll: (event: React.UIEvent<HTMLElement>) => void;
  /** Scrolls the viewport just far enough that the row is visible. */
  readonly reveal: (viewport: HTMLElement | null, index: number) => void;
}

/**
 * Windows a list of equally high rows to the ones the viewport shows.
 *
 * @remarks
 * Only the visible rows and a few beyond each edge are drawn, however long
 * the list is.
 */
export function useVirtualRows({
  count,
  rowHeight,
  viewportHeight,
}: VirtualRowsOptions): VirtualRows {
  const [scrollTop, setScrollTop] = useState(0);
  const first = Math.floor(scrollTop / rowHeight);
  const visible = Math.ceil(viewportHeight / rowHeight);
  function onScroll(event: React.UIEvent<HTMLElement>): void {
    setScrollTop(event.currentTarget.scrollTop);
  }
  function reveal(viewport: HTMLElement | null, index: number): void {
    if (!viewport) return;
    const top = index * rowHeight;
    if (top < viewport.scrollTop) viewport.scrollTop = top;
    else if (top + rowHeight > viewport.scrollTop + viewportHeight)
      viewport.scrollTop = top + rowHeight - viewportHeight;
    setScrollTop(viewport.scrollTop);
  }
  return {
    start: Math.max(0, first - OVERSCAN_ROWS),
    end: Math.min(count, first + visible + OVERSCAN_ROWS),
    totalHeight: count * rowHeight,
    onScroll,
    reveal,
  };
}
