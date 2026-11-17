import { useEffect, useId, useRef, useState } from "react";

import { cn } from "@/app/lib/cn";

import type { ReactElement, ReactNode } from "react";

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
    if (event.key === "Escape") close();
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

/**
 * A hint below its trigger that shows after the pointer rested on it for
 * 1500 ms, and at once when the trigger gets the keyboard focus.
 * @remarks
 * Leaving the trigger, losing the focus or Escape hides it. The hint is
 * linked to the trigger through `aria-describedby`, so a screen reader names
 * it with the trigger.
 */
export function Tooltip({
  content,
  children,
  align = "end",
  delayMs = TOOLTIP_HOVER_DELAY_MS,
}: TooltipProps): React.ReactElement {
  const tooltipId = useId();
  const tooltip = useDelayedTooltip(delayMs);
  return (
    <span
      className="relative inline-flex shrink-0"
      onPointerEnter={tooltip.handlePointerEnter}
      onPointerLeave={tooltip.handlePointerLeave}
      onPointerDown={tooltip.handlePointerDown}
      onFocus={tooltip.handleFocus}
      onBlur={tooltip.handleBlur}
      onKeyDown={tooltip.handleKeyDown}
    >
      {children(tooltipId)}
      <span
        id={tooltipId}
        role="tooltip"
        hidden={!tooltip.isOpen}
        className={cn(
          "absolute top-full z-50 w-72 pt-2",
          align === "end" ? "right-0" : "left-0",
        )}
      >
        <span className="block rounded-lg bg-surface p-3 text-xs leading-relaxed text-foreground shadow-panel ring-1 ring-border">
          {content}
        </span>
      </span>
    </span>
  );
}
