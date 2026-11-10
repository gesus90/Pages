import { useState } from "react";
import { createPortal } from "react-dom";

import { FloatingPanel } from "@/app/components/ui/card";
import { cn } from "@/app/lib/cn";

import styles from "./foreground-panel.module.css";

import type { HTMLAttributes, ReactNode } from "react";

interface ForegroundPanelProps extends HTMLAttributes<HTMLElement> {
  readonly children: ReactNode;
  /** Pixels an on-screen keyboard covers; the panel ends above it. */
  readonly keyboardInset?: number;
  /** Fills the main area beside the navigation instead of a reading width, as a terminal needs. */
  readonly isWide?: boolean;
  /** Centred in the window, at most 82 × 52 rem and at least 28 px from its edges, as the Pages terminal of an agent node (PAGE-289). */
  readonly isFullscreen?: boolean;
}

/**
 * Renders into the document body; the server renders nothing.
 *
 * @remarks
 * The panel opens only in the browser, so the body is known at the first
 * render and the content mounts together with its caller, whose effects can
 * focus it at once.
 */
function BodyPortal({
  children,
}: {
  readonly children: ReactNode;
}): React.ReactElement | null {
  const [target] = useState(() =>
    typeof document === "undefined" ? null : document.body,
  );
  return target ? createPortal(children, target) : null;
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
  isWide = false,
  isFullscreen = false,
  ...properties
}: ForegroundPanelProps): React.ReactElement {
  const panel = (
    <>
      <div
        aria-hidden="true"
        className={cn(
          styles.backdrop,
          isFullscreen && styles.fullscreenBackdrop,
        )}
      />
      <div
        className={cn(styles.positioner, isFullscreen && styles.fullscreen)}
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
            isWide && styles.wide,
            "pointer-events-auto h-full max-h-none w-full overflow-hidden p-0",
            className,
          )}
        >
          {children}
        </FloatingPanel>
      </div>
    </>
  );
  // Above every layer of the page, the app header included; only Pica's symbol lies above it.
  return isFullscreen ? <BodyPortal>{panel}</BodyPortal> : panel;
}
