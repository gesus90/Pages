import { createElement, useCallback, useRef } from "react";

import { cn } from "@/app/lib/cn";

import { ScrollFades } from "./scroll-viewport/scroll-fades";
import { useScrollEdges } from "./scroll-viewport/use-scroll-edges";
import styles from "./scroll-viewport.module.css";

import type { CSSProperties, HTMLAttributes, Ref } from "react";

/** A native scroll viewport; layout constraints belong to its outer container. */
interface ScrollViewportProps extends HTMLAttributes<HTMLElement> {
  readonly as?: "div" | "section" | "ul" | "pre" | "span" | "aside";
  readonly axis?: "vertical" | "horizontal" | "both";
  readonly containerClassName?: string;
  /** Placement of floating surfaces; scrolling styles stay on the native viewport. */
  readonly containerStyle?: CSSProperties;
  readonly fadeClassName?: string;
  /** Native geometry updates, including initial size and dynamic content changes. */
  readonly onViewportMeasure?: (viewport: HTMLElement) => void;
  /** Receives the native element, preserving focus and scrolling integrations. */
  readonly ref?: Ref<HTMLElement>;
}

/**
 * Decorates native scrolling without masking its shell, scrollbar or sticky rows.
 * Container classes set size and placement; viewport classes lay out the content.
 */
export function ScrollViewport({
  as = "div",
  axis = "vertical",
  containerClassName,
  containerStyle,
  className,
  fadeClassName,
  onViewportMeasure,
  children,
  ref,
  ...properties
}: ScrollViewportProps): React.ReactElement {
  const container = useRef<HTMLElement | null>(null);
  const viewport = useRef<HTMLElement | null>(null);
  const edges = useScrollEdges(viewport, container, onViewportMeasure);

  const setViewport = useCallback(
    (element: HTMLElement | null): void => {
      viewport.current = element;
      if (typeof ref === "function") ref(element);
      else if (ref) ref.current = element;
    },
    [ref],
  );

  const overflowClasses = {
    vertical: "pages-scroll-vertical overflow-x-hidden overflow-y-auto",
    horizontal: "pages-scroll-horizontal overflow-x-auto overflow-y-hidden",
    both: "overflow-auto",
  };

  return createElement(
    as === "span" ? "span" : "div",
    {
      ref: container,
      style: containerStyle,
      className: cn(
        "relative grid min-h-0 min-w-0 grid-rows-[minmax(0,1fr)]",
        containerClassName,
      ),
      "data-scroll-area": "",
    },
    createElement(
      as,
      {
        ...properties,
        ref: setViewport,
        className: cn(
          "pages-scroll-viewport min-h-0 min-w-0 max-h-[inherit]",
          styles.nativeViewport,
          overflowClasses[axis],
          className,
        ),
      },
      children,
    ),
    <ScrollFades edges={edges} className={fadeClassName} />,
  );
}
