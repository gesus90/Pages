import { useEffect, useRef } from "react";

import { QuotaCardPointerDrag } from "./quota-card-pointer-drag";
import { SORTABLE_CARD_SELECTOR } from "./quota-card-sort";

import type { QuotaSortContext } from "./quota-card-sort";

/**
 * Sorts the quota cards by pointer: mouse, finger and pen alike.
 * @param context - What the sorting shares.
 * @returns The handler of a press on the handle of a card.
 * @remarks
 * A press on the handle starts a drag once the pointer has travelled a few
 * pixels, so a tap on the handle does nothing. The drag ends when the
 * pointer lets go, which puts the card down, or when Escape or the system
 * cancels it, which puts the card back. Closing the page ends a drag
 * without a move.
 */
export function useQuotaPointerSort(
  context: QuotaSortContext,
): (event: React.PointerEvent<HTMLElement>, connectionId: string) => void {
  const { gridRef, connectionIds, session, setSession, putDown, latest } =
    context;
  const drag = useRef<QuotaCardPointerDrag | null>(null);

  useEffect(() => () => drag.current?.cancel(), []);

  return (event, connectionId) => {
    const grid = gridRef.current;
    const card = event.currentTarget.closest<HTMLElement>(
      SORTABLE_CARD_SELECTOR,
    );
    if (!grid || !card || session !== null) return;
    if (event.button !== 0 || !event.isPrimary) return;
    // The press must not select text or move the focus; the drop returns it.
    event.preventDefault();
    const fromIndex = connectionIds.indexOf(connectionId);
    let isPickedUp = false;
    const pointerDrag = new QuotaCardPointerDrag({
      start: {
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
      },
      card,
      cells: () =>
        Array.from(grid.querySelectorAll<HTMLElement>(SORTABLE_CARD_SELECTOR)),
      onStart: () => {
        isPickedUp = true;
        setSession({
          activeId: connectionId,
          targetIndex: fromIndex,
          source: "pointer",
        });
        latest.current.announce("pickedUp", connectionId, fromIndex);
      },
      onTarget: (targetIndex) =>
        setSession((current) =>
          current === null ? null : { ...current, targetIndex },
        ),
      onEnd: (targetIndex) => {
        drag.current = null;
        if (isPickedUp) putDown(connectionId, targetIndex);
      },
    });
    drag.current = pointerDrag;
    pointerDrag.begin();
  };
}
