import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { useSidebarResize } from "./use-sidebar-resize";

import type { RefObject } from "react";

interface SidebarResizeHandleProps {
  /** Identifier of the sidebar the edge resizes. */
  readonly controlsId: string;
  readonly shellRef: RefObject<HTMLElement | null>;
  readonly sidebarRef: RefObject<HTMLElement | null>;
  readonly preferredWidth: number | null;
  /** Whether the edge is being dragged; it stays highlighted meanwhile. */
  readonly isResizing: boolean;
  readonly onResizeStart: () => void;
  readonly onResizeEnd: (width: number) => void;
}

/**
 * The draggable right edge of the open sidebar, also a focusable separator
 * that arrow keys, Home and End resize.
 *
 * @remarks
 * The edge lies inside the sidebar padding, so it covers neither links nor
 * the main area.
 */
export function SidebarResizeHandle({
  controlsId,
  shellRef,
  sidebarRef,
  preferredWidth,
  isResizing,
  onResizeStart,
  onResizeEnd,
}: SidebarResizeHandleProps): React.ReactElement {
  const { t } = useTranslation();
  const { range, handlePointerDown, handleKeyDown } = useSidebarResize({
    shellRef,
    sidebarRef,
    preferredWidth,
    onResizeStart,
    onResizeEnd,
  });

  return (
    <div
      aria-controls={controlsId}
      aria-label={t("navigation.resize")}
      aria-orientation="vertical"
      aria-valuemax={range?.maximum}
      aria-valuemin={range?.minimum}
      aria-valuenow={range?.width}
      aria-valuetext={
        range
          ? t("navigation.resizeValue", {
              width: range.width,
              maximum: range.maximum,
            })
          : undefined
      }
      className="group absolute inset-y-0 right-0 w-3 cursor-col-resize touch-none outline-none"
      role="separator"
      tabIndex={0}
      title={t("navigation.resize")}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute inset-y-0 right-0 w-0.5 rounded-full transition-colors group-hover:bg-muted-foreground/40 group-focus-visible:bg-primary",
          isResizing ? "bg-primary" : "bg-transparent",
        )}
      />
    </div>
  );
}
