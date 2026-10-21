/** The native content box after clipping by enclosing overflow surfaces. */
export interface ScrollVisibleBox {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
  readonly clippedTop: number;
  readonly clippedRight: number;
  readonly clippedBottom: number;
  readonly clippedLeft: number;
}

function contentBox(element: HTMLElement): DOMRect {
  const bounds = element.getBoundingClientRect();
  const scale = element.offsetWidth ? bounds.width / element.offsetWidth : 1;
  return new DOMRect(
    bounds.left + element.clientLeft * scale,
    bounds.top + element.clientTop * scale,
    element.clientWidth * scale,
    element.clientHeight * scale,
  );
}

/** Keeps local fades at the visible edge of nested panels, never across the canvas. */
export function scrollVisibleBox(viewport: HTMLElement): ScrollVisibleBox {
  const full = contentBox(viewport);
  let { top, right, bottom, left } = full;
  let ancestor = viewport.parentElement;
  while (ancestor && ancestor !== document.body) {
    const overflow = getComputedStyle(ancestor);
    const clip = contentBox(ancestor);
    if (/auto|scroll|hidden|clip/.test(overflow.overflowX)) {
      left = Math.max(left, clip.left);
      right = Math.min(right, clip.right);
    }
    if (/auto|scroll|hidden|clip/.test(overflow.overflowY)) {
      top = Math.max(top, clip.top);
      bottom = Math.min(bottom, clip.bottom);
    }
    ancestor = ancestor.parentElement;
  }
  return {
    top,
    right,
    bottom,
    left,
    clippedTop: Math.max(0, top - full.top),
    clippedRight: Math.max(0, full.right - right),
    clippedBottom: Math.max(0, full.bottom - bottom),
    clippedLeft: Math.max(0, left - full.left),
  };
}
