import { cn } from "@/app/lib/cn";

import { ScrollViewport } from "./scroll-viewport";

import type { CSSProperties, ReactNode, Ref, UIEvent } from "react";
import type {
  ScrollFadeMode,
  ScrollMaskEdge,
} from "./scroll-viewport/scroll-mask";

interface VerticalScrollAreaProps {
  readonly children: ReactNode;
  readonly className?: string;
  readonly viewportClassName?: string;
  readonly contentClassName?: string;
  readonly fadeClassName?: string;
  /** `overlay` lays coloured fades over the edges; `mask` fades the content itself. */
  readonly fadeMode?: ScrollFadeMode;
  /** The edges a masking area fades; both by default. */
  readonly fadeEdges?: readonly ScrollMaskEdge[];
  /** Length of a masking area's upper fade in CSS pixels. */
  readonly fadeTop?: number;
  readonly style?: CSSProperties;
  /** Receives the native scrolling element, such as to put its position back. */
  readonly viewportRef?: Ref<HTMLElement>;
  readonly onScroll?: (event: UIEvent<HTMLElement>) => void;
}

/** Renders native vertical scrolling with the shared, measured edge fades. */
export function VerticalScrollArea({
  children,
  className,
  viewportClassName,
  contentClassName,
  fadeClassName,
  fadeMode,
  fadeEdges,
  fadeTop,
  style,
  viewportRef,
  onScroll,
}: VerticalScrollAreaProps): React.ReactElement {
  return (
    <ScrollViewport
      containerClassName={className}
      className={viewportClassName}
      fadeClassName={fadeClassName}
      fadeMode={fadeMode}
      fadeEdges={fadeEdges}
      fadeTop={fadeTop}
      style={style}
      ref={viewportRef}
      onScroll={onScroll}
    >
      <div className={cn("flex flex-col", contentClassName)}>{children}</div>
    </ScrollViewport>
  );
}
