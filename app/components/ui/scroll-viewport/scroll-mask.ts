import type { CSSProperties } from "react";
import type { ScrollEdges } from "./scroll-edges";

/** How a viewport fades its edges: a coloured overlay, or a mask of its own content. */
export type ScrollFadeMode = "overlay" | "mask";

/** A physical edge a masking viewport fades where more content waits beyond it. */
export type ScrollMaskEdge = "top" | "bottom" | "left" | "right";

/** Length of a vertical fade in CSS pixels, as long as the overlay's vertical fade. */
export const DEFAULT_SCROLL_FADE_SIZE = 40;

/** Length of a horizontal fade in CSS pixels, as long as the overlay's horizontal fade. */
export const DEFAULT_SCROLL_FADE_HORIZONTAL_SIZE = 48;

/** The column of the native scrollbar, which the mask leaves untouched. */
const SCROLLBAR_COLUMN = "0.75rem";

/** The edges a masking viewport fades and the length of each fade. */
export interface ScrollMaskOptions {
  readonly fadeEdges: readonly ScrollMaskEdge[];
  /** Length of the upper fade in CSS pixels. */
  readonly fadeTop: number;
  /** Length of the lower fade in CSS pixels; the overlay's length when absent. */
  readonly fadeBottom?: number;
  /** Length of the left fade in CSS pixels; the overlay's length when absent. */
  readonly fadeLeft?: number;
  /** Length of the right fade in CSS pixels; the overlay's length when absent. */
  readonly fadeRight?: number;
  /** Whether the viewport shows a scrollbar column; `true` when absent. */
  readonly hasScrollbar?: boolean;
}

/** The gradient stops of one axis: transparent at each faded end, opaque between. */
function fadeStops(
  start: { readonly isFaded: boolean; readonly size: number },
  end: { readonly isFaded: boolean; readonly size: number },
): string {
  const startStops = start.isFaded
    ? `transparent 0px, #000 ${start.size}px`
    : "#000 0px";
  const endStops = end.isFaded
    ? `#000 calc(100% - ${end.size}px), transparent 100%`
    : "#000 100%";
  return `${startStops}, ${endStops}`;
}

/**
 * Masks a viewport's content so it fades out at each chosen edge with more content beyond it.
 * @param edges - The measured edges where more content waits.
 * @param options - The faded edges and the length of each fade.
 * @returns The mask declarations for the native viewport.
 * @remarks
 * A mask lets whatever lies behind the viewport, such as a design's painting,
 * show through the fade, where a coloured overlay would lie on it as a block.
 * A viewport with a scrollbar fades the top and bottom only and a second,
 * opaque layer keeps the scrollbar column unmasked. A viewport without a
 * scrollbar column fades all four edges; its two axes intersect, so a corner
 * fades by the stronger of both. Edges that cannot scroll are never measured as
 * having more content, so only the fade of the scroll direction shows.
 */
export function scrollMaskStyle(
  edges: Pick<ScrollEdges, "top" | "bottom" | "left" | "right">,
  options: ScrollMaskOptions,
): CSSProperties {
  const fadesTop = edges.top && options.fadeEdges.includes("top");
  const fadesBottom = edges.bottom && options.fadeEdges.includes("bottom");
  const vertical = fadeStops(
    { isFaded: fadesTop, size: options.fadeTop },
    {
      isFaded: fadesBottom,
      size: options.fadeBottom ?? DEFAULT_SCROLL_FADE_SIZE,
    },
  );
  if (options.hasScrollbar === false) {
    const horizontal = fadeStops(
      {
        isFaded: edges.left && options.fadeEdges.includes("left"),
        size: options.fadeLeft ?? DEFAULT_SCROLL_FADE_HORIZONTAL_SIZE,
      },
      {
        isFaded: edges.right && options.fadeEdges.includes("right"),
        size: options.fadeRight ?? DEFAULT_SCROLL_FADE_HORIZONTAL_SIZE,
      },
    );
    return {
      maskImage: `linear-gradient(to bottom, ${vertical}), linear-gradient(to right, ${horizontal})`,
      maskComposite: "intersect",
      maskRepeat: "no-repeat",
    };
  }
  return {
    maskImage: `linear-gradient(to bottom, ${vertical}), linear-gradient(#000, #000)`,
    maskSize: `calc(100% - ${SCROLLBAR_COLUMN}) 100%, ${SCROLLBAR_COLUMN} 100%`,
    maskPosition: "0 0, 100% 0",
    maskRepeat: "no-repeat",
  };
}
