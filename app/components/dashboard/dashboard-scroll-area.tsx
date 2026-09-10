import { useEffect, useRef, useState } from "react";

import { cn } from "@/app/lib/cn";

import styles from "./dashboard-scroll-area.module.css";

import type { ReactNode } from "react";

interface DashboardScrollAreaProps {
  readonly children: ReactNode;
}

interface ScrollEdges {
  readonly hasContentTop: boolean;
  readonly hasContentBottom: boolean;
}

/** Renders the dashboard's vertical scroll viewport with edge fades. */
export function DashboardScrollArea({
  children,
}: DashboardScrollAreaProps): React.ReactElement {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [scrollEdges, setScrollEdges] = useState<ScrollEdges>({
    hasContentBottom: false,
    hasContentTop: false,
  });

  useEffect(() => {
    const viewport: HTMLDivElement = viewportRef.current as HTMLDivElement;

    const measure = (): void => {
      const hasContentTop = viewport.scrollTop > 1;
      const hasContentBottom =
        viewport.scrollTop + viewport.clientHeight < viewport.scrollHeight - 1;

      setScrollEdges((previous) => {
        if (
          previous.hasContentTop === hasContentTop &&
          previous.hasContentBottom === hasContentBottom
        ) {
          return previous;
        }

        return { hasContentBottom, hasContentTop };
      });
    };

    measure();
    viewport.addEventListener("scroll", measure, { passive: true });

    if (typeof ResizeObserver === "undefined") {
      return () => {
        viewport.removeEventListener("scroll", measure);
      };
    }

    const observer = new ResizeObserver(measure);
    observer.observe(viewport);

    return () => {
      viewport.removeEventListener("scroll", measure);
      observer.disconnect();
    };
  }, []);

  return (
    <div className={cn(styles.scrollArea, "min-h-0 flex-1")}>
      <div
        ref={viewportRef}
        id="dashboard-viewport"
        className={cn(styles.viewport, "pages-hover-scrollbar")}
      >
        <div className={styles.content}>{children}</div>
      </div>
      <div
        aria-hidden="true"
        className={cn(
          styles.fade,
          styles.fadeTop,
          scrollEdges.hasContentTop && styles.fadeVisible,
        )}
      />
      <div
        aria-hidden="true"
        className={cn(
          styles.fade,
          styles.fadeBottom,
          scrollEdges.hasContentBottom && styles.fadeVisible,
        )}
      />
    </div>
  );
}
