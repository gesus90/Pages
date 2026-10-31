import {
  autoUpdate,
  computePosition,
  flip,
  offset,
  shift,
  size,
} from "@floating-ui/dom";
import { useLayoutEffect, useState } from "react";

interface PanelPosition {
  readonly x: number;
  readonly y: number;
  readonly maxHeight: number;
}

/** Positions the filter panel beside its trigger and inside the viewport. */
export function useFilterPanelPosition(
  trigger: HTMLElement | null,
  panel: HTMLElement | null,
): React.CSSProperties {
  const [position, setPosition] = useState<PanelPosition | null>(null);

  useLayoutEffect(() => {
    if (!trigger || !panel) return undefined;
    let isCurrent = true;
    let maxHeight = 0;
    async function place(): Promise<void> {
      if (!trigger || !panel) return;
      const placed = await computePosition(trigger, panel, {
        placement: "bottom-end",
        strategy: "fixed",
        middleware: [
          offset(8),
          flip({ padding: 8 }),
          shift({ padding: 8 }),
          size({
            padding: 8,
            apply: ({ availableHeight }) => {
              maxHeight = availableHeight;
            },
          }),
        ],
      });
      if (isCurrent) setPosition({ x: placed.x, y: placed.y, maxHeight });
    }
    const stop = autoUpdate(trigger, panel, () => void place());
    return () => {
      isCurrent = false;
      stop();
    };
  }, [trigger, panel]);

  return position
    ? {
        position: "fixed",
        left: position.x,
        top: position.y,
        maxHeight: position.maxHeight,
      }
    : { position: "fixed", left: 0, top: 0, opacity: 0, pointerEvents: "none" };
}
