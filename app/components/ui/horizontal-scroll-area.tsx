import { cn } from "@/app/lib/cn";

import { ScrollViewport } from "./scroll-viewport";

import type { ReactNode } from "react";

interface HorizontalScrollAreaProps {
  readonly children: ReactNode;
  readonly className?: string;
  readonly viewportClassName?: string;
  readonly contentClassName?: string;
  readonly viewportRef?: { current: HTMLDivElement | null };
  readonly onViewportScroll?: (viewport: HTMLDivElement) => void;
}

/** Renders native horizontal scrolling with physical edge fades, including RTL. */
export function HorizontalScrollArea({
  children,
  className,
  viewportClassName,
  contentClassName,
  viewportRef,
  onViewportScroll,
}: HorizontalScrollAreaProps): React.ReactElement {
  function setViewport(element: HTMLElement | null): void {
    if (viewportRef)
      viewportRef.current = element instanceof HTMLDivElement ? element : null;
  }
  function handleMeasure(element: HTMLElement): void {
    if (element instanceof HTMLDivElement) onViewportScroll?.(element);
  }
  return (
    <ScrollViewport
      axis="horizontal"
      containerClassName={className}
      className={viewportClassName}
      ref={setViewport}
      onViewportMeasure={handleMeasure}
    >
      <div className={cn("flex", contentClassName)}>{children}</div>
    </ScrollViewport>
  );
}
