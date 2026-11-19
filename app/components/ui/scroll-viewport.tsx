import { createElement, useCallback, useRef } from "react";

import { cn } from "@/app/lib/cn";

import { ScrollFades } from "./scroll-viewport/scroll-fades";
import {
  DEFAULT_SCROLL_FADE_HORIZONTAL_SIZE,
  DEFAULT_SCROLL_FADE_SIZE,
  scrollMaskStyle,
} from "./scroll-viewport/scroll-mask";
import { useScrollEdges } from "./scroll-viewport/use-scroll-edges";
import styles from "./scroll-viewport.module.css";

import type { CSSProperties, HTMLAttributes, Ref } from "react";
import type {
  ScrollFadeMode,
  ScrollMaskEdge,
} from "./scroll-viewport/scroll-mask";

const ALL_MASK_EDGES: readonly ScrollMaskEdge[] = ["top", "bottom"];

/** The scrolling direction of a viewport. */
type ScrollAxis = "vertical" | "horizontal" | "both";

const OVERFLOW_CLASSES: Readonly<Record<ScrollAxis, string>> = {
  vertical: "pages-scroll-vertical overflow-x-hidden overflow-y-auto",
  horizontal: "pages-scroll-horizontal overflow-x-auto overflow-y-hidden",
  both: "overflow-auto",
};

/** Passes the native element on to a forwarded ref, as a callback or an object. */
function assignViewportRef(
  ref: Ref<HTMLElement> | undefined,
  element: HTMLElement | null,
): void {
  if (typeof ref === "function") ref(element);
  else if (ref) ref.current = element;
}

/** The class names of the container that places the viewport. */
function containerClassNameOf(
  isShell: boolean,
  containerClassName: string | undefined,
): string {
  return cn(
    "relative grid min-h-0 min-w-0 grid-rows-[minmax(0,1fr)]",
    isShell && "overflow-hidden",
    containerClassName,
  );
}

/** The class names of the native scrolling element. */
function viewportClassName(
  axis: ScrollAxis,
  options: {
    readonly isShell: boolean;
    readonly hideScrollbar: boolean;
    readonly className?: string;
  },
): string {
  const { isShell, hideScrollbar, className } = options;
  return cn(
    "pages-scroll-viewport min-h-0 min-w-0 max-h-[inherit]",
    styles.nativeViewport,
    OVERFLOW_CLASSES[axis],
    hideScrollbar && "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
    // The shell clips, so a focus outline has to lie inside the viewport.
    isShell && "pages-scroll-shelled focus-visible:-outline-offset-2",
    className,
  );
}

/** A native scroll viewport; layout constraints belong to its outer container. */
interface ScrollViewportProps extends HTMLAttributes<HTMLElement> {
  readonly as?: "div" | "section" | "ul" | "pre" | "span" | "aside";
  readonly axis?: ScrollAxis;
  readonly containerClassName?: string;
  /** Placement of floating surfaces; scrolling styles stay on the native viewport. */
  readonly containerStyle?: CSSProperties;
  /**
   * Makes the container the shell of a surface with a radius: it clips the
   * viewport and carries radius, fill, ring and shadow, while the viewport keeps
   * none of them. The scrollbar then lies inside the rounded corners and takes
   * no column while nothing scrolls.
   */
  readonly isShell?: boolean;
  readonly fadeClassName?: string;
  /** `overlay` lays coloured fades over the edges; `mask` fades the content itself. */
  readonly fadeMode?: ScrollFadeMode;
  /** The edges a masking viewport fades; both by default. */
  readonly fadeEdges?: readonly ScrollMaskEdge[];
  /** Length of a masking viewport's upper fade in CSS pixels. */
  readonly fadeTop?: number;
  /** Length of a masking viewport's lower fade in CSS pixels. */
  readonly fadeBottom?: number;
  /** Length of a masking viewport's left fade in CSS pixels. */
  readonly fadeLeft?: number;
  /** Length of a masking viewport's right fade in CSS pixels. */
  readonly fadeRight?: number;
  /**
   * Hides the native scrollbar while the viewport still scrolls; only a
   * masking viewport then fades the left and right edges, too.
   */
  readonly hideScrollbar?: boolean;
  /** Native geometry updates, including initial size and dynamic content changes. */
  readonly onViewportMeasure?: (viewport: HTMLElement) => void;
  /** Receives the native element, preserving focus and scrolling integrations. */
  readonly ref?: Ref<HTMLElement>;
}

/**
 * Decorates native scrolling without masking its shell, scrollbar or sticky rows.
 * Container classes set size and placement; viewport classes lay out the content.
 * @remarks
 * A surface with a radius sets `isShell` and puts radius, fill, ring and shadow
 * on the container class, never on the viewport: a native scrollbar column
 * paints square over the rounding of the scrolling element itself.
 * In the `mask` mode the viewport masks its own content at the edges where
 * more content waits and renders no overlay, so a surface or a painting
 * behind it shows through the fade; its scrollbar column stays unmasked.
 * With `hideScrollbar` the viewport has no scrollbar column and fades the
 * left and right edges, too, as far as `fadeEdges` names them.
 */
export function ScrollViewport({
  as = "div",
  axis = "vertical",
  containerClassName,
  containerStyle,
  isShell = false,
  className,
  fadeClassName,
  fadeMode = "overlay",
  fadeEdges = ALL_MASK_EDGES,
  fadeTop = DEFAULT_SCROLL_FADE_SIZE,
  fadeBottom = DEFAULT_SCROLL_FADE_SIZE,
  fadeLeft = DEFAULT_SCROLL_FADE_HORIZONTAL_SIZE,
  fadeRight = DEFAULT_SCROLL_FADE_HORIZONTAL_SIZE,
  hideScrollbar = false,
  onViewportMeasure,
  children,
  ref,
  style,
  ...properties
}: ScrollViewportProps): React.ReactElement {
  const container = useRef<HTMLElement | null>(null);
  const viewport = useRef<HTMLElement | null>(null);
  const edges = useScrollEdges(viewport, container, onViewportMeasure);

  const setViewport = useCallback(
    (element: HTMLElement | null): void => {
      viewport.current = element;
      assignViewportRef(ref, element);
    },
    [ref],
  );

  const isMasked = fadeMode === "mask";
  const viewportStyle = isMasked
    ? {
        ...style,
        ...scrollMaskStyle(edges, {
          fadeEdges,
          fadeTop,
          fadeBottom,
          fadeLeft,
          fadeRight,
          hasScrollbar: !hideScrollbar,
        }),
      }
    : style;

  return createElement(
    as === "span" ? "span" : "div",
    {
      ref: container,
      style: containerStyle,
      className: containerClassNameOf(isShell, containerClassName),
      "data-scroll-area": "",
    },
    createElement(
      as,
      {
        ...properties,
        ref: setViewport,
        style: viewportStyle,
        className: viewportClassName(axis, {
          isShell,
          hideScrollbar,
          className,
        }),
      },
      children,
    ),
    isMasked ? null : <ScrollFades edges={edges} className={fadeClassName} />,
  );
}
