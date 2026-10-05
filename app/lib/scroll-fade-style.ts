import type { CSSProperties } from "react";

/** Inline style that carries the colour channels a scroll area fades into. */
export interface ScrollFadeStyle extends CSSProperties {
  readonly "--scroll-fade-channels": string;
}

/** The scroll fade of panels on a white surface. */
export const WHITE_SCROLL_FADE_STYLE: ScrollFadeStyle = {
  "--scroll-fade-channels": "255 255 255",
};
