import { ScrollViewport } from "@/app/components/ui/scroll-viewport";

import type { ReactNode } from "react";

/** Keeps project-card shadow space and gutter inside the common native viewport. */
export function ProjectGridScrollArea({
  children,
}: {
  readonly children: ReactNode;
}): React.ReactElement {
  return (
    <ScrollViewport
      containerClassName="mt-8 min-h-0 flex-1"
      className="overscroll-contain"
    >
      <div className="pt-2 pr-4 pb-8 pl-2">{children}</div>
    </ScrollViewport>
  );
}
