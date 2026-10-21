import { ScrollViewport } from "@/app/components/ui/scroll-viewport";

import type { ReactNode } from "react";

/** Renders the dashboard's native viewport with the common scroll decoration. */
export function DashboardScrollArea({
  children,
}: {
  readonly children: ReactNode;
}): React.ReactElement {
  return (
    <ScrollViewport
      containerClassName="h-full w-full min-h-0 flex-1"
      className="overscroll-y-contain pr-3"
      id="dashboard-viewport"
    >
      <div className="flex flex-col gap-5 px-1 pt-1 pb-10">{children}</div>
    </ScrollViewport>
  );
}
