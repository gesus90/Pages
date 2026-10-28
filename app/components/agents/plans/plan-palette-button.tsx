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

import { Button } from "@/app/components/ui/button";

import type { ButtonProps } from "@/app/components/ui/button";

interface PaletteButtonProps extends ButtonProps {
  readonly tooltip: string;
  /** A press shows the tooltip until the next press elsewhere, so touch and pointer users can read it. */
  readonly showsOnPress?: boolean;
  /** Layout of the tooltip anchor when used in a bounded sequence. */
  readonly wrapperClassName?: string;
}

function usePaletteTooltipVisibility(): {
  readonly isOpen: boolean;
  readonly enter: () => void;
  readonly leave: () => void;
  readonly focus: () => void;
  readonly blur: () => void;
  readonly dismiss: () => void;
  readonly isPinned: boolean;
  readonly togglePin: () => void;
  readonly unpin: () => void;
} {
  const [isHovered, setHovered] = useState(false);
  const [isFocused, setFocused] = useState(false);
  const [isDismissed, setDismissed] = useState(false);
  const [isPinned, setPinned] = useState(false);
  return {
    isOpen: ((isHovered || isFocused) && !isDismissed) || isPinned,
    isPinned,
    togglePin: () => {
      setDismissed(false);
      setPinned((pinned) => !pinned);
    },
    unpin: () => setPinned(false),
    enter: () => {
      setHovered(true);
      setDismissed(false);
    },
    leave: () => setHovered(false),
    focus: () => {
      setFocused(true);
      setDismissed(false);
    },
    blur: () => setFocused(false),
    dismiss: () => setDismissed(true),
  };
}

/** Places the tooltip beside its trigger; a stale placement of a closed tooltip is dropped. */
async function placeTooltip(
  anchor: HTMLElement,
  overlay: HTMLElement,
  isCurrent: () => boolean,
): Promise<void> {
  try {
    const position = await computePosition(anchor, overlay, {
      strategy: "fixed",
      placement: "left",
      middleware: [
        offset(8),
        flip({
          padding: 8,
          fallbackPlacements: ["top", "bottom", "right"],
        }),
        shift({ padding: 8, crossAxis: true }),
      ],
    });
    if (!isCurrent()) return;
    Object.assign(overlay.style, {
      left: `${position.x}px`,
      top: `${position.y}px`,
      visibility: "visible",
    });
  } catch (error: unknown) {
    console.warn("Could not position the node palette tooltip.", error);
  }
}

/** A Pages button with a hover/focus description above the editor overlays. */
export function PlanPaletteButton({
  tooltip,
  showsOnPress = false,
  wrapperClassName,
  ...properties
}: PaletteButtonProps): React.ReactElement {
  const tooltipId = useId();
  const trigger = useRef<HTMLSpanElement>(null);
  const floating = useRef<HTMLSpanElement>(null);
  const visibility = usePaletteTooltipVisibility();
  const { isOpen, enter, leave, focus, blur, dismiss } = visibility;
  const { isPinned, togglePin, unpin } = visibility;
  useEffect(() => {
    if (!isPinned) return;
    function closeOutside(event: PointerEvent): void {
      const { target } = event;
      if (target instanceof Node && trigger.current?.contains(target)) return;
      unpin();
    }
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [isPinned, unpin]);
  useEffect(() => {
    const reference = trigger.current;
    const panel = floating.current;
    if (!isOpen || !reference || !panel) return;
    let isCurrent = true;
    const stop = autoUpdate(
      reference,
      panel,
      () => void placeTooltip(reference, panel, () => isCurrent),
    );
    return () => {
      isCurrent = false;
      stop();
    };
  }, [isOpen, tooltip]);
  return (
    <span
      ref={trigger}
      className={cn("block min-w-0", wrapperClassName)}
      onMouseEnter={enter}
      onMouseLeave={leave}
      onFocus={focus}
      onBlur={blur}
      onPointerDown={showsOnPress ? undefined : dismiss}
      onDragStartCapture={dismiss}
      onClickCapture={showsOnPress ? togglePin : dismiss}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        dismiss();
        unpin();
      }}
    >
      <Button
        {...properties}
        aria-describedby={isOpen ? tooltipId : undefined}
      />
      {isOpen
        ? createPortal(
            <span
              ref={floating}
              id={tooltipId}
              role="tooltip"
              style={{ visibility: "hidden" }}
              className="pointer-events-none fixed z-50 max-w-[min(18rem,calc(100vw-1rem))] rounded-lg border border-border bg-surface px-3 py-2 text-xs leading-relaxed whitespace-pre-line text-foreground shadow-panel"
            >
              {tooltip}
            </span>,
            document.body,
          )
        : null}
    </span>
  );
}
