import {
  autoUpdate,
  computePosition,
  flip,
  offset,
  shift,
} from "@floating-ui/dom";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/app/lib/cn";

import type { ReactElement, ReactNode, RefObject } from "react";

/** The gap between the trigger and its hint, in px. */
const HINT_GAP = 8;

/** How long the pointer rests on the trigger before its hint shows. */
export const TOOLTIP_HOVER_DELAY_MS = 1500;

/** Which edge of the trigger the hint aligns with. */
type TooltipAlign = "start" | "end";

interface TooltipProps {
  /** What the hint says. */
  readonly content: ReactNode;
  /** Renders the trigger; it receives the ID to name in `aria-describedby`. */
  readonly children: (tooltipId: string) => ReactElement;
  readonly align?: TooltipAlign;
  readonly delayMs?: number;
  /**
   * Draws the hint outside the trigger's ancestors, fixed under the trigger, so a
   * scroll area or an `overflow` box around the trigger never cuts it off.
   */
  readonly isFloating?: boolean;
  /** Keeps the trigger mounted when there is no hint to show. */
  readonly isDisabled?: boolean;
  /** Classes of the element around the trigger, for a trigger that fills its row. */
  readonly className?: string;
}

/** The open state of a hint: late on hover, at once on keyboard focus. */
interface DelayedTooltip {
  readonly isOpen: boolean;
  readonly handlePointerEnter: (event: React.PointerEvent) => void;
  readonly handlePointerLeave: () => void;
  readonly handlePointerDown: () => void;
  readonly handleFocus: () => void;
  readonly handleBlur: () => void;
  readonly handleKeyDown: (event: React.KeyboardEvent) => void;
}

function useDelayedTooltip(delayMs: number): DelayedTooltip {
  const [isOpen, setIsOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // A focus that follows a press of the pointer is no keyboard focus.
  const isPointerFocus = useRef(false);

  function cancel(): void {
    if (timer.current === null) return;
    clearTimeout(timer.current);
    timer.current = null;
  }

  // A hint whose trigger leaves the page never opens afterwards.
  useEffect(() => {
    const pending = timer;
    return () => {
      if (pending.current !== null) clearTimeout(pending.current);
    };
  }, []);

  function handlePointerEnter(event: React.PointerEvent): void {
    if (event.pointerType === "touch") return;
    cancel();
    timer.current = setTimeout(() => {
      timer.current = null;
      setIsOpen(true);
    }, delayMs);
  }

  function close(): void {
    cancel();
    setIsOpen(false);
  }

  function handlePointerLeave(): void {
    isPointerFocus.current = false;
    close();
  }

  function handlePointerDown(): void {
    isPointerFocus.current = true;
  }

  function handleFocus(): void {
    if (isPointerFocus.current) {
      isPointerFocus.current = false;
      return;
    }
    cancel();
    setIsOpen(true);
  }

  function handleKeyDown(event: React.KeyboardEvent): void {
    if (event.key !== "Escape" || !isOpen) return;
    event.preventDefault();
    close();
  }

  return {
    isOpen,
    handlePointerEnter,
    handlePointerLeave,
    handlePointerDown,
    handleFocus,
    handleBlur: close,
    handleKeyDown,
  };
}

/** Puts the hint under its trigger, edge to edge on the chosen side; a placement that is already stale is dropped. */
async function placeHint(
  anchor: HTMLElement,
  hint: HTMLElement,
  options: { readonly align: TooltipAlign; readonly isCurrent: () => boolean },
): Promise<void> {
  try {
    const position = await computePosition(anchor, hint, {
      strategy: "fixed",
      placement: options.align === "end" ? "bottom-end" : "bottom-start",
      middleware: [
        offset(HINT_GAP),
        flip({ padding: HINT_GAP }),
        shift({ padding: HINT_GAP }),
      ],
    });
    if (!options.isCurrent()) return;
    Object.assign(hint.style, {
      left: `${position.x}px`,
      top: `${position.y}px`,
      visibility: "visible",
    });
  } catch (error: unknown) {
    console.warn("Could not position the tooltip.", error);
  }
}

/** The hint of a floating tooltip: in the page body, so no scroll area around the trigger can cut it off. */
function FloatingHint({
  id,
  anchor,
  align,
  children,
}: {
  readonly id: string;
  readonly anchor: RefObject<HTMLElement | null>;
  readonly align: TooltipAlign;
  readonly children: ReactNode;
}): React.ReactElement {
  const hint = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const reference = anchor.current;
    const panel = hint.current;
    if (!reference || !panel) return undefined;
    let isCurrent = true;
    const stop = autoUpdate(reference, panel, () => {
      void placeHint(reference, panel, { align, isCurrent: () => isCurrent });
    });
    return () => {
      isCurrent = false;
      stop();
    };
  }, [anchor, align]);
  return createPortal(
    <span
      ref={hint}
      id={id}
      role="tooltip"
      style={{ visibility: "hidden" }}
      className="pointer-events-none fixed top-0 left-0 z-50 block w-72 rounded-lg border border-border bg-surface p-3 text-xs leading-relaxed text-foreground shadow-panel"
    >
      {children}
    </span>,
    document.body,
  );
}

/**
 * A hint below its trigger that shows after the pointer rested on it for
 * 1500 ms, and at once when the trigger gets the keyboard focus.
 * @remarks
 * Leaving the trigger, losing the focus or Escape hides it. The hint is
 * linked to the trigger through `aria-describedby`, so a screen reader names
 * it with the trigger. A floating hint is drawn in the page body, 8 px
 * under the trigger and ending flush with it, and follows the trigger while
 * a scroll area moves it.
 */
export function Tooltip({
  content,
  children,
  align = "end",
  delayMs = TOOLTIP_HOVER_DELAY_MS,
  isFloating = false,
  isDisabled = false,
  className,
}: TooltipProps): React.ReactElement {
  const tooltipId = useId();
  const tooltip = useDelayedTooltip(delayMs);
  const isOpen = !isDisabled && tooltip.isOpen;
  const trigger = useRef<HTMLSpanElement>(null);
  return (
    <span
      ref={trigger}
      className={cn("relative inline-flex shrink-0", className)}
      onPointerEnter={isDisabled ? undefined : tooltip.handlePointerEnter}
      onPointerLeave={tooltip.handlePointerLeave}
      onPointerDown={isDisabled ? undefined : tooltip.handlePointerDown}
      onFocus={isDisabled ? undefined : tooltip.handleFocus}
      onBlur={tooltip.handleBlur}
      onKeyDown={isDisabled ? undefined : tooltip.handleKeyDown}
    >
      {children(tooltipId)}
      {isFloating ? null : (
        <span
          id={tooltipId}
          role="tooltip"
          hidden={!isOpen}
          className={cn(
            "absolute top-full z-50 w-72 pt-2",
            align === "end" ? "right-0" : "left-0",
          )}
        >
          <span className="block rounded-lg bg-surface p-3 text-xs leading-relaxed text-foreground shadow-panel ring-1 ring-border">
            {content}
          </span>
        </span>
      )}
      {isFloating && isOpen ? (
        <FloatingHint id={tooltipId} anchor={trigger} align={align}>
          {content}
        </FloatingHint>
      ) : null}
    </span>
  );
}
