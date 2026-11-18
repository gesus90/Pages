import type { CSSProperties } from "react";
import type { ScrollEdges } from "./scroll-edges";

/** How a viewport fades its edges: a coloured overlay, or a mask of its own content. */
export type ScrollFadeMode = "overlay" | "mask";

/** An edge a masking viewport fades where more content waits beyond it. */
export type ScrollMaskEdge = "top" | "bottom";

/** Length of a fade in CSS pixels, as long as the overlay's vertical fade. */
export const DEFAULT_SCROLL_FADE_SIZE = 40;

/** The column of the native scrollbar, which the mask leaves untouched. */
const SCROLLBAR_COLUMN = "0.75rem";

/** The edges a masking viewport fades and the length of its upper and lower fade. */
export interface ScrollMaskOptions {
  readonly fadeEdges: readonly ScrollMaskEdge[];
  /** Length of the upper fade in CSS pixels. */
  readonly fadeTop: number;
  /** Length of the lower fade in CSS pixels; the overlay's length when absent. */
  readonly fadeBottom?: number;
}

/**
 * Masks a viewport's content so it fades out at each chosen edge with more content beyond it.
 * @param edges - The measured edges where more content waits.
 * @param options - The faded edges and the length of the upper and lower fade.
 * @returns The mask declarations for the native viewport.
 * @remarks
 * A mask lets whatever lies behind the viewport, such as a design's painting,
 * show through the fade, where a coloured overlay would lie on it as a block.
 * A second, opaque layer keeps the scrollbar column unmasked.
 */
export function scrollMaskStyle(
  edges: Pick<ScrollEdges, "top" | "bottom">,
  options: ScrollMaskOptions,
): CSSProperties {
  const fadesTop = edges.top && options.fadeEdges.includes("top");
  const fadesBottom = edges.bottom && options.fadeEdges.includes("bottom");
  const topStops = fadesTop
    ? `transparent 0px, #000 ${options.fadeTop}px`
    : "#000 0px";
  const bottomStops = fadesBottom
    ? `#000 calc(100% - ${options.fadeBottom ?? DEFAULT_SCROLL_FADE_SIZE}px), transparent 100%`
    : "#000 100%";
  return {
    maskImage: `linear-gradient(to bottom, ${topStops}, ${bottomStops}), linear-gradient(#000, #000)`,
    maskSize: `calc(100% - ${SCROLLBAR_COLUMN}) 100%, ${SCROLLBAR_COLUMN} 100%`,
    maskPosition: "0 0, 100% 0",
    maskRepeat: "no-repeat",
  };
}
