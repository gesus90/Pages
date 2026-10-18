import {
  autoUpdate,
  computePosition,
  flip,
  offset,
  shift,
} from "@floating-ui/dom";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/app/components/ui/button";

import type { ButtonProps } from "@/app/components/ui/button";

interface PaletteButtonProps extends ButtonProps {
  readonly tooltip: string;
}

function usePaletteTooltipVisibility(): {
  readonly isOpen: boolean;
  readonly enter: () => void;
  readonly leave: () => void;
  readonly focus: () => void;
  readonly blur: () => void;
  readonly dismiss: () => void;
} {
  const [isHovered, setHovered] = useState(false);
  const [isFocused, setFocused] = useState(false);
  const [isDismissed, setDismissed] = useState(false);
  return {
    isOpen: (isHovered || isFocused) && !isDismissed,
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

/** A Pages button with a hover/focus description above the editor overlays. */
export function PlanPaletteButton({
  tooltip,
  ...properties
}: PaletteButtonProps): React.ReactElement {
  const tooltipId = useId();
  const trigger = useRef<HTMLSpanElement>(null);
  const floating = useRef<HTMLSpanElement>(null);
  const { isOpen, enter, leave, focus, blur, dismiss } =
    usePaletteTooltipVisibility();
  useEffect(() => {
    const reference = trigger.current;
    const panel = floating.current;
    if (!isOpen || !reference || !panel) return;
    let isCurrent = true;
    async function place(): Promise<void> {
      if (!reference || !panel) return;
      try {
        const position = await computePosition(reference, panel, {
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
        if (!isCurrent) return;
        Object.assign(panel.style, {
          left: `${position.x}px`,
          top: `${position.y}px`,
          visibility: "visible",
        });
      } catch (error: unknown) {
        console.warn("Could not position the node palette tooltip.", error);
      }
    }
    const stop = autoUpdate(reference, panel, () => void place());
    return () => {
      isCurrent = false;
      stop();
    };
  }, [isOpen, tooltip]);
  return (
    <span
      ref={trigger}
      className="block min-w-0"
      onMouseEnter={enter}
      onMouseLeave={leave}
      onFocus={focus}
      onBlur={blur}
      onPointerDown={dismiss}
      onDragStartCapture={dismiss}
      onClickCapture={dismiss}
      onKeyDown={(event) => {
        if (event.key === "Escape") dismiss();
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
              className="pointer-events-none fixed z-50 max-w-[min(18rem,calc(100vw-1rem))] rounded-lg border border-border bg-surface px-3 py-2 text-xs leading-relaxed text-foreground shadow-panel"
            >
              {tooltip}
            </span>,
            document.body,
          )
        : null}
    </span>
  );
}
