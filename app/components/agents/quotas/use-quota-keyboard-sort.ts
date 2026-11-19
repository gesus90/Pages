import { useEffect } from "react";

import { keyboardSortStep, SORTABLE_CARD_SELECTOR } from "./quota-card-sort";

import type { QuotaSortContext } from "./quota-card-sort";

/** The keyboard handlers of the handle of a card. */
export interface QuotaKeyboardSort {
  readonly handleKeyDown: (
    event: React.KeyboardEvent<HTMLElement>,
    connectionId: string,
  ) => void;
  readonly handleBlur: (connectionId: string) => void;
}

/**
 * Sorts the quota cards by keyboard.
 * @param context - What the sorting shares.
 * @returns The handlers for the keys and for leaving the handle.
 * @remarks
 * Enter or Space at the handle picks the card up; the arrow keys, Home and
 * End move the place it would take, which scrolls into view; Enter or Space
 * puts it down and Escape puts it back. Leaving the handle, for example with
 * Tab, puts the card back, so no card stays in hand unseen.
 */
export function useQuotaKeyboardSort(
  context: QuotaSortContext,
): QuotaKeyboardSort {
  const { gridRef, connectionIds, session, setSession, putDown, announce } =
    context;
  const keyboardTarget =
    session?.source === "keyboard" ? session.targetIndex : null;

  useEffect(() => {
    if (keyboardTarget === null) return;
    const cells = gridRef.current?.querySelectorAll<HTMLElement>(
      SORTABLE_CARD_SELECTOR,
    );
    Array.from(cells ?? [])[keyboardTarget]?.scrollIntoView({
      block: "nearest",
    });
  }, [gridRef, keyboardTarget]);

  function handleKeyDown(
    event: React.KeyboardEvent<HTMLElement>,
    connectionId: string,
  ): void {
    const index = connectionIds.indexOf(connectionId);
    const isGrabbed =
      session?.source === "keyboard" && session.activeId === connectionId;
    if (session !== null && !isGrabbed) return;
    const targetIndex = session?.targetIndex ?? index;
    const step = keyboardSortStep(event.key, {
      isGrabbed,
      targetIndex,
      count: connectionIds.length,
    });
    if (step.kind === "ignore") return;
    event.preventDefault();
    switch (step.kind) {
      case "pickUp":
        setSession({ activeId: connectionId, targetIndex, source: "keyboard" });
        announce("pickedUp", connectionId, index);
        return;
      case "move":
        setSession({
          activeId: connectionId,
          targetIndex: step.index,
          source: "keyboard",
        });
        announce("moved", connectionId, step.index);
        return;
      case "cancel":
        setSession(null);
        announce("cancelled", connectionId, index);
        return;
      case "drop":
        putDown(connectionId, targetIndex);
        return;
    }
  }

  function handleBlur(connectionId: string): void {
    if (session?.source === "keyboard" && session.activeId === connectionId)
      setSession(null);
  }

  return { handleKeyDown, handleBlur };
}
