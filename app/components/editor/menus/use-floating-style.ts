import { computePosition, flip, offset, shift } from "@floating-ui/dom";
import { useLayoutEffect, useState } from "react";

import type { Placement } from "@floating-ui/dom";

/**
 * Places a floating element next to a screen rectangle and keeps it inside
 * the viewport.
 *
 * @param floating - The element to place; `null` until it is rendered.
 * @param reference - The rectangle it belongs to, such as the caret.
 * @param placement - Preferred side of the rectangle.
 * @returns Fixed-position styles for the element.
 */
export function useFloatingStyle(
  floating: HTMLElement | null,
  reference: DOMRect | null,
  placement: Placement = "bottom-start",
): React.CSSProperties {
  const [position, setPosition] = useState<{ x: number; y: number } | null>(
    null,
  );

  useLayoutEffect(() => {
    if (!floating || !reference) {
      return undefined;
    }

    let isCurrent = true;

    void computePosition({ getBoundingClientRect: () => reference }, floating, {
      middleware: [offset(6), flip(), shift({ padding: 8 })],
      placement,
      strategy: "fixed",
    }).then(({ x, y }) => {
      if (isCurrent) {
        setPosition({ x, y });
      }
    });

    return () => {
      isCurrent = false;
    };
  }, [floating, reference, placement]);

  return {
    left: position?.x ?? reference?.left ?? 0,
    position: "fixed",
    top: position?.y ?? (reference?.bottom ?? 0) + 6,
  };
}
