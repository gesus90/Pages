import { cn } from "@/app/lib/cn";

import { ScrollViewport } from "./scroll-viewport";

import type { CSSProperties, ReactNode } from "react";

interface VerticalScrollAreaProps {
  readonly children: ReactNode;
  readonly className?: string;
  readonly viewportClassName?: string;
  readonly contentClassName?: string;
  readonly fadeClassName?: string;
  readonly style?: CSSProperties;
}

/** Renders native vertical scrolling with the shared, measured edge fades. */
export function VerticalScrollArea({
  children,
  className,
  viewportClassName,
  contentClassName,
  fadeClassName,
  style,
}: VerticalScrollAreaProps): React.ReactElement {
  return (
    <ScrollViewport
      containerClassName={className}
      className={viewportClassName}
      fadeClassName={fadeClassName}
      style={style}
    >
      <div className={cn("flex flex-col", contentClassName)}>{children}</div>
    </ScrollViewport>
  );
}
