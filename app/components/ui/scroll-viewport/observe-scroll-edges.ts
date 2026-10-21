import { measureScrollEdges, scrollFadeInsets } from "./scroll-edges";
import { scrollSurfaceColor } from "./scroll-surface-color";

import type { ScrollEdges } from "./scroll-edges";

/** Observes native offsets and content/layout changes without polling or DOM wrapping. */
export function observeScrollEdges(
  viewport: HTMLElement,
  container: HTMLElement,
  onChange: (edges: ScrollEdges) => void,
  onMeasure?: (viewport: HTMLElement) => void,
): () => void {
  let frame = 0;
  function measure(): void {
    frame = 0;
    const next = {
      ...measureScrollEdges(viewport),
      style: {
        ...scrollFadeInsets(viewport, container),
        "--scroll-fade-color": scrollSurfaceColor(viewport),
      },
    };
    onChange(next);
    onMeasure?.(viewport);
  }
  function schedule(): void {
    if (!frame) frame = requestAnimationFrame(measure);
  }
  function ancestorScroll(event: Event): void {
    if (event.target instanceof Node && event.target.contains(viewport))
      schedule();
  }
  const resize = new ResizeObserver(schedule);
  function observeContent(): void {
    resize.disconnect();
    resize.observe(viewport);
    resize.observe(container);
    for (const child of viewport.children) resize.observe(child);
    let ancestor = viewport.parentElement;
    while (ancestor && ancestor !== document.body) {
      if (/auto|scroll|hidden|clip/.test(getComputedStyle(ancestor).overflow))
        resize.observe(ancestor);
      ancestor = ancestor.parentElement;
    }
    schedule();
  }
  const content = new MutationObserver(observeContent);
  content.observe(viewport, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
  });
  const theme = new MutationObserver(schedule);
  theme.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class", "data-theme", "dir"],
  });
  const preferences = [
    "(prefers-color-scheme: dark)",
    "(forced-colors: active)",
    "(prefers-contrast: more)",
  ].map((query) => window.matchMedia(query));
  for (const preference of preferences)
    preference.addEventListener("change", schedule);
  viewport.addEventListener("scroll", schedule, { passive: true });
  viewport.addEventListener("load", schedule, true);
  viewport.addEventListener("input", schedule);
  window.addEventListener("resize", schedule);
  window.visualViewport?.addEventListener("resize", schedule);
  document.fonts.addEventListener("loadingdone", schedule);
  document.addEventListener("scroll", ancestorScroll, true);
  observeContent();
  return () => {
    cancelAnimationFrame(frame);
    resize.disconnect();
    content.disconnect();
    theme.disconnect();
    for (const preference of preferences)
      preference.removeEventListener("change", schedule);
    viewport.removeEventListener("scroll", schedule);
    viewport.removeEventListener("load", schedule, true);
    viewport.removeEventListener("input", schedule);
    window.removeEventListener("resize", schedule);
    window.visualViewport?.removeEventListener("resize", schedule);
    document.fonts.removeEventListener("loadingdone", schedule);
    document.removeEventListener("scroll", ancestorScroll, true);
  };
}
