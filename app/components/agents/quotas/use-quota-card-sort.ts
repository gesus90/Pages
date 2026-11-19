import { useEffect, useRef, useState } from "react";

import { QuotaCardPointerDrag } from "./quota-card-pointer-drag";
import { SORTABLE_CARD_SELECTOR } from "./quota-card-sort";
import { useQuotaKeyboardSort } from "./use-quota-keyboard-sort";
import { useQuotaSortAnnouncement } from "./use-quota-sort-announcement";

import type { RefObject } from "react";
import type { QuotaSortContext, QuotaSortSession } from "./quota-card-sort";
import type { QuotaCard } from "./quota-state";

/** What the sorting of the quota cards needs. */
export interface QuotaCardSortInput {
  /** The cards in display order. */
  readonly cards: readonly QuotaCard[];
  /** Puts a card at a position; called when the person puts it down. */
  readonly onMove: (connectionId: string, toIndex: number) => void;
}

/** The sorting of the quota cards: the card in hand and what moves it. */
export interface QuotaCardSort {
  /** Goes on the grid, which holds every card and nothing else that sorts. */
  readonly gridRef: RefObject<HTMLDivElement | null>;
  /** The card in hand and the place it would take; `null` when none is. */
  readonly session: QuotaSortSession | null;
  /** The sentence for the live region of the grid. */
  readonly announcement: string;
  readonly startPointerDrag: (
    event: React.PointerEvent<HTMLElement>,
    connectionId: string,
  ) => void;
  readonly handleKeyDown: (
    event: React.KeyboardEvent<HTMLElement>,
    connectionId: string,
  ) => void;
  readonly handleBlur: (connectionId: string) => void;
}

/**
 * Sorts the quota cards by pointer and by keyboard.
 * @param input - The cards and what happens when one is put down.
 * @returns The state of the sorting and the handlers of the handles.
 * @remarks
 * The card in hand stays where it is while it is moved; only the place it
 * would take is marked, and the cards change places when it is put down, so
 * a drag changes nothing in the grid but that mark. After the move the focus
 * returns to the handle of the moved card, which the browser may have
 * dropped while the cards changed places.
 */
export function useQuotaCardSort({
  cards,
  onMove,
}: QuotaCardSortInput): QuotaCardSort {
  const gridRef = useRef<HTMLDivElement>(null);
  const [openSession, setSession] = useState<QuotaSortSession | null>(null);
  const { announcement, announce } = useQuotaSortAnnouncement(cards);
  const latest = useRef({ cards, onMove, announce });
  const connectionIds = cards.map((card) => card.account.connectionId);
  const rememberFocus = useHandleFocusAfterMove(
    gridRef,
    connectionIds.join("\n"),
  );
  // A card that leaves while it is in hand ends the sorting by itself.
  const isInHandPresent =
    openSession !== null && connectionIds.includes(openSession.activeId);
  const session = isInHandPresent ? openSession : null;

  useEffect(() => {
    latest.current = { cards, onMove, announce };
  });

  function putDown(connectionId: string, targetIndex: number | null): void {
    setSession(null);
    const newest = latest.current;
    const fromIndex = newest.cards.findIndex(
      (card) => card.account.connectionId === connectionId,
    );
    if (targetIndex === null) {
      newest.announce("cancelled", connectionId, fromIndex);
      return;
    }
    if (targetIndex !== fromIndex) rememberFocus(connectionId);
    newest.onMove(connectionId, targetIndex);
    newest.announce("dropped", connectionId, targetIndex);
  }

  const context: QuotaSortContext = {
    gridRef,
    connectionIds,
    session,
    setSession,
    putDown,
    announce,
    latest,
  };
  const startPointerDrag = useQuotaPointerSort(context);
  const { handleKeyDown, handleBlur } = useQuotaKeyboardSort(context);

  return {
    gridRef,
    session,
    announcement,
    startPointerDrag,
    handleKeyDown,
    handleBlur,
  };
}

function useHandleFocusAfterMove(
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

function useQuotaPointerSort(
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
