import { useEffect, useRef, useState } from "react";

import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  RefObject,
} from "react";

/** Width change of one arrow key press in CSS pixels. */
const KEYBOARD_STEP = 16;

/** Arrow keys with Shift move this many steps at once. */
const LARGE_STEP_FACTOR = 4;

/** Custom property of the shell that carries the chosen open width. */
const PREFERRED_WIDTH_PROPERTY = "--app-sidebar-preferred";

/** Current width of the open sidebar and the range it may take. */
export interface SidebarWidthRange {
  readonly width: number;
  readonly minimum: number;
  readonly maximum: number;
}

interface SidebarResizeOptions {
  readonly shellRef: RefObject<HTMLElement | null>;
  readonly sidebarRef: RefObject<HTMLElement | null>;
  /** Last chosen open width; a change measures the range again. */
  readonly preferredWidth: number | null;
  readonly onResizeStart: () => void;
  readonly onResizeEnd: (width: number) => void;
}

/** What the resize edge needs to render and to react to input. */
export interface SidebarResize {
  /** `null` until the browser measured the sidebar. */
  readonly range: SidebarWidthRange | null;
  readonly handlePointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly handleKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
}

interface DragOptions {
  readonly handle: HTMLElement;
  readonly shell: HTMLElement;
  readonly sidebar: HTMLElement;
  readonly pointerId: number;
  readonly startX: number;
  readonly onEnd: (width: number) => void;
}

function measureRange(sidebar: HTMLElement): SidebarWidthRange {
  // The minimum is the designed width the stylesheet puts on the open sidebar.
  const minimum = Number.parseFloat(getComputedStyle(sidebar).minWidth) || 0;

  return {
    width: Math.round(sidebar.getBoundingClientRect().width),
    minimum: Math.round(minimum),
    // Half the viewport in CSS pixels, scrollbar included like `50vw`.
    maximum: Math.floor(Math.max(minimum, window.innerWidth / 2)),
  };
}

function clampWidth(width: number, range: SidebarWidthRange): number {
  return Math.round(Math.min(Math.max(width, range.minimum), range.maximum));
}

function getKeyboardWidth(
  event: ReactKeyboardEvent<HTMLElement>,
  range: SidebarWidthRange,
): number | null {
  const step = event.shiftKey
    ? KEYBOARD_STEP * LARGE_STEP_FACTOR
    : KEYBOARD_STEP;

  switch (event.key) {
    case "ArrowLeft":
      return range.width - step;
    case "ArrowRight":
      return range.width + step;
    case "Home":
      return range.minimum;
    case "End":
      return range.maximum;
    default:
      return null;
  }
}

/**
 * Follows one pointer from the sidebar edge until it is released, cancelled
 * or the window loses focus, and returns a function that stops following.
 *
 * The width goes straight onto the shell while dragging, so the pages below
 * do not render again for every pointer move; only the end is reported.
 */
function followPointer({
  handle,
  shell,
  sidebar,
  pointerId,
  startX,
  onEnd,
}: DragOptions): () => void {
  const range = measureRange(sidebar);
  let width = range.width;

  function handleMove(event: PointerEvent): void {
    if (event.pointerId !== pointerId) {
      return;
    }

    width = clampWidth(range.width + event.clientX - startX, range);
    shell.style.setProperty(PREFERRED_WIDTH_PROPERTY, `${width}px`);
  }

  function detach(): void {
    handle.removeEventListener("pointermove", handleMove);
    handle.removeEventListener("pointerup", finish);
    handle.removeEventListener("pointercancel", finish);
    handle.removeEventListener("lostpointercapture", finish);
    window.removeEventListener("blur", finish);

    if (handle.hasPointerCapture(pointerId)) {
      handle.releasePointerCapture(pointerId);
    }
  }

  function finish(): void {
    detach();
    onEnd(width);
  }

  handle.setPointerCapture(pointerId);
  handle.addEventListener("pointermove", handleMove);
  handle.addEventListener("pointerup", finish);
  handle.addEventListener("pointercancel", finish);
  handle.addEventListener("lostpointercapture", finish);
  window.addEventListener("blur", finish);

  return detach;
}

/**
 * Drag and keyboard resizing of the open sidebar edge.
 *
 * @remarks
 * Listeners exist only while a drag runs and go away with it, also when the
 * edge unmounts mid-drag. The range follows window size, zoom and breakpoint.
 */
export function useSidebarResize({
  shellRef,
  sidebarRef,
  preferredWidth,
  onResizeStart,
  onResizeEnd,
}: SidebarResizeOptions): SidebarResize {
  const [range, setRange] = useState<SidebarWidthRange | null>(null);
  const stopDragRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const sidebar = sidebarRef.current;

    if (!sidebar) {
      return;
    }

    function handleWindowResize(): void {
      // Small screens hide the sidebar for the mobile menu; it has no width then.
      if (sidebar && sidebar.getClientRects().length > 0) {
        setRange(measureRange(sidebar));
      }
    }

    handleWindowResize();
    window.addEventListener("resize", handleWindowResize);

    return () => window.removeEventListener("resize", handleWindowResize);
  }, [sidebarRef, preferredWidth]);

  useEffect(() => () => stopDragRef.current?.(), []);

  function handleDragEnd(width: number): void {
    stopDragRef.current = null;
    onResizeEnd(width);
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLElement>): void {
    const shell = shellRef.current;
    const sidebar = sidebarRef.current;

    if (event.button !== 0 || !shell || !sidebar || stopDragRef.current) {
      return;
    }

    // Keeps the browser from starting a text selection or a native drag.
    event.preventDefault();
    event.currentTarget.focus();
    onResizeStart();
    stopDragRef.current = followPointer({
      handle: event.currentTarget,
      shell,
      sidebar,
      pointerId: event.pointerId,
      startX: event.clientX,
      onEnd: handleDragEnd,
    });
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLElement>): void {
    const sidebar = sidebarRef.current;

    if (!sidebar) {
      return;
    }

    const current = measureRange(sidebar);
    const target = getKeyboardWidth(event, current);

    if (target === null) {
      return;
    }

    event.preventDefault();
    onResizeEnd(clampWidth(target, current));
  }

  return { range, handlePointerDown, handleKeyDown };
}
