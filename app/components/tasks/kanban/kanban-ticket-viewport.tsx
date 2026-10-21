import { ScrollViewport } from "@/app/components/ui/scroll-viewport";
import { cn } from "@/app/lib/cn";

import styles from "../tasks-kanban.module.css";

import type { ReactNode } from "react";

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

/** Renders a column's tickets without covering its header, scrollbar or card shadows. */
export function KanbanTicketViewport({
  children,
  statusKey,
}: {
  readonly children: ReactNode;
  readonly statusKey: string;
}): React.ReactElement {
  return (
    <ScrollViewport
      containerClassName={cn(
        "-mx-1 min-h-0 flex-1",
        getColumnFadeClass(statusKey),
      )}
      className="overscroll-y-contain"
    >
      <div className="flex min-h-min flex-col gap-3 pt-1 pr-3.5 pb-2 pl-1">
        {children}
      </div>
    </ScrollViewport>
  );
}
