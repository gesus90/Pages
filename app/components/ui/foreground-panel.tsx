import { FloatingPanel } from "@/app/components/ui/card";
import { cn } from "@/app/lib/cn";

import styles from "./foreground-panel.module.css";

import type { HTMLAttributes, ReactNode } from "react";

interface ForegroundPanelProps extends HTMLAttributes<HTMLElement> {
  readonly children: ReactNode;
  /** Pixels an on-screen keyboard covers; the panel ends above it. */
  readonly keyboardInset?: number;
}

/**
 * The fixed foreground panel of the ticket view over a dimmed backdrop.
 *
 * @remarks
 * Position, size, animation and theme follow the layout, never stored
 * window coordinates: the panel cannot be moved or resized, and the page
 * below keeps its layout. The backdrop takes pointer input without closing
 * the panel; X and Escape close it.
 */
export function ForegroundPanel({
  children,
  className,
  keyboardInset = 0,
  ...properties
}: ForegroundPanelProps): React.ReactElement {
  return (
    <>
      <div aria-hidden="true" className={styles.backdrop} />
      <div
        className={styles.positioner}
        style={
          keyboardInset > 0
            ? { bottom: `calc(0.75rem + ${keyboardInset}px)` }
            : undefined
        }
      >
        <FloatingPanel
          aria-modal="false"
          role="dialog"
          {...properties}
          className={cn(
            styles.panel,
            "pointer-events-auto h-full max-h-none w-full overflow-hidden p-0",
            className,
          )}
        >
          {children}
        </FloatingPanel>
      </div>
    </>
  );
}
