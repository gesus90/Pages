import { useEffect, useRef, useState } from "react";

import { cn } from "@/app/lib/cn";

import styles from "./kanban-scroll-area.module.css";

import type { ReactNode } from "react";

interface KanbanScrollAreaProps {
  readonly children: ReactNode;
}

interface ScrollEdges {
  readonly hasContentLeft: boolean;
  readonly hasContentRight: boolean;
}

/** Renders the Kanban's native horizontal scroll viewport with edge fades. */
export function KanbanScrollArea({
  children,
}: KanbanScrollAreaProps): React.ReactElement {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [scrollEdges, setScrollEdges] = useState<ScrollEdges>({
    hasContentLeft: false,
    hasContentRight: false,
  });

  useEffect(() => {
    const viewport = viewportRef.current as HTMLDivElement;

    const measure = (): void => {
      const hasContentLeft = viewport.scrollLeft > 1;
      const hasContentRight =
        viewport.scrollLeft + viewport.clientWidth < viewport.scrollWidth - 1;

      setScrollEdges((previous) => {
        if (
          previous.hasContentLeft === hasContentLeft &&
          previous.hasContentRight === hasContentRight
        ) {
          return previous;
        }

        return { hasContentLeft, hasContentRight };
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
    <div className={styles.scrollArea}>
      <div
        ref={viewportRef}
        id="tasks-kanban-viewport"
        className={cn(styles.viewport, "pages-hover-scrollbar")}
      >
        <div className={styles.content}>{children}</div>
      </div>
      <div
        aria-hidden="true"
        className={cn(
          "pages-scroll-fade-start",
          styles.fade,
          styles.fadeLeft,
          scrollEdges.hasContentLeft && styles.fadeVisible,
        )}
      />
      <div
        aria-hidden="true"
        className={cn(
          "pages-scroll-fade-end",
          styles.fade,
          styles.fadeRight,
          scrollEdges.hasContentRight && styles.fadeVisible,
        )}
      />
    </div>
  );
}
