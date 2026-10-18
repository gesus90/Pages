import {
  autoUpdate,
  computePosition,
  flip,
  offset,
  shift,
  size,
} from "@floating-ui/dom";
import { useLayoutEffect, useState } from "react";

interface PickerPosition {
  readonly x: number;
  readonly y: number;
  readonly maxHeight: number;
}

// The gap between the field and the panel, and the margin to the window edges.
const PICKER_OFFSET = 5;
const VIEWPORT_MARGIN = 8;

/**
 * Anchors the open ticket choice below its field, widening to the right.
 *
 * @param field - The field on the card; `null` until it is rendered.
 * @param panel - The panel in its portal; `null` until it is rendered.
 * @returns Fixed-position styles; the panel stays transparent until it is
 * placed, but focusable, so its search field takes the focus at once.
 *
 * @remarks
 * Near the bottom of the window the panel opens upwards, near the right
 * edge it moves left, and on a short window its list shrinks. The position
 * follows the field every frame, so pan and zoom of the canvas keep it
 * attached without changing any node coordinates.
 */
export function useTicketPickerPosition(
  field: HTMLElement | null,
  panel: HTMLElement | null,
): React.CSSProperties {
  const [position, setPosition] = useState<PickerPosition | null>(null);

  useLayoutEffect(() => {
    if (!field || !panel) return undefined;
    let isCurrent = true;
    let maxHeight = 0;
    async function place(
      reference: HTMLElement,
      floating: HTMLElement,
    ): Promise<void> {
      const placed = await computePosition(reference, floating, {
        placement: "bottom-start",
        strategy: "fixed",
        middleware: [
          offset(PICKER_OFFSET),
          flip({ padding: VIEWPORT_MARGIN, fallbackPlacements: ["top-start"] }),
          shift({ padding: VIEWPORT_MARGIN }),
          size({
            padding: VIEWPORT_MARGIN,
            apply: ({ availableHeight }) => {
              maxHeight = availableHeight;
            },
          }),
        ],
      });
      if (!isCurrent) return;
      // Each frame measures again; only a real move renders the panel again.
      setPosition((previous) =>
        previous?.x === placed.x &&
        previous.y === placed.y &&
        previous.maxHeight === maxHeight
          ? previous
          : { x: placed.x, y: placed.y, maxHeight },
      );
    }
    const stop = autoUpdate(field, panel, () => void place(field, panel), {
      animationFrame: true,
    });
    return () => {
      isCurrent = false;
      stop();
    };
  }, [field, panel]);

  if (!position)
    return {
      position: "fixed",
      left: 0,
      top: 0,
      opacity: 0,
      pointerEvents: "none",
    };
  return {
    position: "fixed",
    left: position.x,
    top: position.y,
    maxHeight: position.maxHeight,
  };
}
