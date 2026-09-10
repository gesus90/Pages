import { cn } from "@/app/lib/cn";

import type { HTMLAttributes, ReactNode } from "react";

interface PageContentProps extends HTMLAttributes<HTMLDivElement> {
  readonly children: ReactNode;
}

/**
 * Renders the floating content surface used by Pages routes.
 *
 * @remarks
 * Der Content steht auf dem durchgehenden App-Hintergrund als
 * dezente eigenständige Fläche: leicht abgesetzt, gerundet,
 * mit dezentem Schatten und ohne starke Borders.
 */
export function PageContent({
  children,
  className,
  ...properties
}: PageContentProps): React.ReactElement {
  return (
    <div
      className={cn(
        "pages-content-card min-w-0 flex-1 px-5 py-6 sm:px-7 xl:px-9 xl:py-7",
        className,
      )}
      {...properties}
    >
      {children}
    </div>
  );
}

interface FloatingPanelProps extends HTMLAttributes<HTMLElement> {
  readonly children: ReactNode;
}

/**
 * Renders a floating contextual panel such as the ticket detail panel.
 *
 * @remarks
 * Schwebend, gerundet, mit Abstand zum Fensterrand und eigenem
 * Schatten statt einer fest verbauten Sidebar.
 */
export function FloatingPanel({
  children,
  className,
  ...properties
}: FloatingPanelProps): React.ReactElement {
  return (
    <aside
      className={cn("pages-floating-panel flex w-full flex-col p-6", className)}
      {...properties}
    >
      {children}
    </aside>
  );
}
