import { useEffect, useRef } from "react";

import type { RefObject } from "react";

/**
 * Gives the focus back to the handle of a card after its place changed.
 * @param gridRef - The grid that holds the cards and their handles.
 * @param orderKey - Names the order of the cards; the focus returns once it
 * changed.
 * @returns A function that names the card whose handle gets the focus back
 * after the next change of the order.
 * @remarks
 * When the cards change places the browser may drop the focus of the moved
 * card, so a keyboard user would start again from the top of the page.
 */
export function useHandleFocusAfterMove(
  gridRef: RefObject<HTMLElement | null>,
  orderKey: string,
): (connectionId: string) => void {
  const pendingId = useRef<string | null>(null);

  useEffect(() => {
    const connectionId = pendingId.current;
    pendingId.current = null;
    if (connectionId === null) return;
    const handles = gridRef.current?.querySelectorAll<HTMLElement>(
      "[data-quota-handle]",
    );
    Array.from(handles ?? [])
      .find((handle) => handle.dataset.quotaHandle === connectionId)
      ?.focus({ preventScroll: true });
  }, [gridRef, orderKey]);

  return (connectionId) => {
    pendingId.current = connectionId;
  };
}
