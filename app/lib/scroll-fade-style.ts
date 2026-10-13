import type { CSSProperties } from "react";

/** Inline style that carries the color a scroll area fades into. */
export interface ScrollFadeStyle extends CSSProperties {
  readonly "--scroll-fade-color": string;
}

/** The scroll fade of panels on a card surface. */
export const SURFACE_SCROLL_FADE_STYLE: ScrollFadeStyle = {
  "--scroll-fade-color": "var(--color-surface)",
};
