import { scrollVisibleBox } from "./scroll-visible-box";

import type { CSSProperties } from "react";

/** Physical edges, independent of the browser's logical RTL scroll origin. */
export interface ScrollEdges {
  readonly top: boolean;
  readonly bottom: boolean;
  readonly left: boolean;
  readonly right: boolean;
  readonly style: CSSProperties;
}

const EDGE_TOLERANCE = 1;

/** Measures native offsets, clamping elastic overscroll at either end. */
export function measureScrollEdges(
  viewport: HTMLElement,
): Omit<ScrollEdges, "style"> {
  const maximumX = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
  const maximumY = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
  const isRtl = getComputedStyle(viewport).direction === "rtl";
  const physicalX = isRtl
    ? maximumX + viewport.scrollLeft
    : viewport.scrollLeft;
  const left = Math.min(maximumX, Math.max(0, physicalX));
  const top = Math.min(maximumY, Math.max(0, viewport.scrollTop));
  const overflow = getComputedStyle(viewport);
  const clipped = scrollVisibleBox(viewport);
  const scale =
    viewport.getBoundingClientRect().width / viewport.offsetWidth || 1;
  const canScrollX =
    maximumX > EDGE_TOLERANCE && /auto|scroll/.test(overflow.overflowX);
  const canScrollY =
    maximumY > EDGE_TOLERANCE && /auto|scroll/.test(overflow.overflowY);
  return {
    left: canScrollX && left + clipped.clippedLeft / scale > EDGE_TOLERANCE,
    right:
      canScrollX &&
      maximumX - left + clipped.clippedRight / scale > EDGE_TOLERANCE,
    top: canScrollY && top + clipped.clippedTop / scale > EDGE_TOLERANCE,
    bottom:
      canScrollY &&
      maximumY - top + clipped.clippedBottom / scale > EDGE_TOLERANCE,
  };
}

/** Keeps overlays inside the content box and clear of sticky headers and footers. */
export function scrollFadeInsets(
  viewport: HTMLElement,
  container: HTMLElement,
): CSSProperties {
  const containerBounds = container.getBoundingClientRect();
  const bounds = scrollVisibleBox(viewport);
  const scale = containerBounds.width
    ? container.offsetWidth / containerBounds.width
    : 1;
  const offsetTop =
    (bounds.top - containerBounds.top) * scale - container.clientTop;
  const offsetLeft =
    (bounds.left - containerBounds.left) * scale - container.clientLeft;
  let top = offsetTop;
  let bottom = top + Math.max(0, bounds.bottom - bounds.top) * scale;
  for (const element of viewport.querySelectorAll<HTMLElement>(
    ".sticky, thead",
  )) {
    const position = getComputedStyle(element);
    if (position.position !== "sticky") continue;
    const sticky = element.getBoundingClientRect();
    if (position.top !== "auto" && sticky.top <= bounds.top + EDGE_TOLERANCE)
      top += Math.max(0, sticky.bottom - bounds.top) * scale;
    else if (
      position.bottom !== "auto" &&
      sticky.bottom >= bounds.bottom - EDGE_TOLERANCE
    )
      bottom -= Math.max(0, bounds.bottom - sticky.top) * scale;
  }
  return {
    top,
    left: offsetLeft,
    width: Math.max(0, bounds.right - bounds.left) * scale,
    height: Math.max(0, bottom - top),
    borderRadius: getComputedStyle(viewport).borderRadius,
  };
}
