import { cn } from "@/app/lib/cn";

import { ScrollViewport } from "./scroll-viewport";

import type { CSSProperties, ReactNode, Ref, UIEvent } from "react";

interface VerticalScrollAreaProps {
  readonly children: ReactNode;
  readonly className?: string;
  readonly viewportClassName?: string;
  readonly contentClassName?: string;
  readonly fadeClassName?: string;
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
  style,
  viewportRef,
  onScroll,
}: VerticalScrollAreaProps): React.ReactElement {
  return (
    <ScrollViewport
      containerClassName={className}
      className={viewportClassName}
      fadeClassName={fadeClassName}
      style={style}
      ref={viewportRef}
      onScroll={onScroll}
    >
      <div className={cn("flex flex-col", contentClassName)}>{children}</div>
    </ScrollViewport>
  );
}
