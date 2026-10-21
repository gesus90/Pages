import { ScrollViewport } from "@/app/components/ui/scroll-viewport";

import type { ReactNode } from "react";

/** Renders the Kanban board with native horizontal scrolling and shared edge fades. */
export function KanbanScrollArea({
  children,
}: {
  readonly children: ReactNode;
}): React.ReactElement {
  return (
    <ScrollViewport
      axis="horizontal"
      containerClassName="h-full min-h-48 w-full"
      className="overscroll-x-contain"
      id="tasks-kanban-viewport"
    >
      <div className="flex h-full w-max min-w-full items-stretch gap-4 px-1 py-2 md:gap-5">
        {children}
      </div>
    </ScrollViewport>
  );
}
