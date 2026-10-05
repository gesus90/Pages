import { useEffect, useRef, useState } from "react";

import { cn } from "@/app/lib/cn";

import styles from "../tasks-kanban.module.css";

import type { ReactNode } from "react";

interface KanbanTicketViewportProps {
  readonly children: ReactNode;
  readonly statusKey: string;
}

interface ScrollEdges {
  readonly hasContentAbove: boolean;
  readonly hasContentBelow: boolean;
}

function getColumnFadeClass(key: string): string {
  if (key === "todo") {
    return styles.todo;
  }

  if (key === "in_progress") {
    return styles.progress;
  }

  if (key === "review") {
    return styles.review;
  }

  if (key === "done") {
    return styles.done;
  }

  return styles.backlog;
}

/** Renders the scrollable ticket list of a column with fades at clipped edges. */
export function KanbanTicketViewport({
  children,
  statusKey,
}: KanbanTicketViewportProps): React.ReactElement {
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [scrollEdges, setScrollEdges] = useState<ScrollEdges>({
    hasContentAbove: false,
    hasContentBelow: false,
  });

  useEffect(() => {
    const viewport = viewportRef.current as HTMLDivElement;

    function updateScrollEdges(): void {
      const hasContentAbove = viewport.scrollTop > 1;
      const hasContentBelow =
        viewport.scrollTop + viewport.clientHeight < viewport.scrollHeight - 1;

      setScrollEdges((previous) => {
        if (
          previous.hasContentAbove === hasContentAbove &&
          previous.hasContentBelow === hasContentBelow
        ) {
          return previous;
        }

        return { hasContentAbove, hasContentBelow };
      });
    }

    updateScrollEdges();
    viewport.addEventListener("scroll", updateScrollEdges, { passive: true });

    if (typeof ResizeObserver === "undefined") {
      return () => {
        viewport.removeEventListener("scroll", updateScrollEdges);
      };
    }

    const observer = new ResizeObserver(updateScrollEdges);
    observer.observe(viewport);
    observer.observe(contentRef.current as HTMLDivElement);

    return () => {
      viewport.removeEventListener("scroll", updateScrollEdges);
      observer.disconnect();
    };
  }, []);

  return (
    <div className={cn(styles.ticketScrollArea, getColumnFadeClass(statusKey))}>
      <div
        ref={viewportRef}
        className={cn(styles.ticketViewport, "pages-hover-scrollbar")}
      >
        <div ref={contentRef} className={styles.ticketList}>
          {children}
        </div>
      </div>
      <div
        aria-hidden="true"
        className={cn(
          "pages-scroll-fade-top",
          styles.fade,
          styles.fadeTop,
          scrollEdges.hasContentAbove && styles.fadeVisible,
        )}
      />
      <div
        aria-hidden="true"
        className={cn(
          "pages-scroll-fade-bottom",
          styles.fade,
          styles.fadeBottom,
          scrollEdges.hasContentBelow && styles.fadeVisible,
        )}
      />
    </div>
  );
}
