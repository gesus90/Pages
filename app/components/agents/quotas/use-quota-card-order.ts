import { useEffect, useReducer, useState } from "react";

import { moveConnectionId, orderQuotaCards } from "./quota-card-order";
import { QuotaOrderRequests } from "./quota-order-requests";
import {
  INITIAL_QUOTA_ORDER_STATE,
  reduceQuotaOrder,
} from "./quota-order-state";

import type { QuotaOrderSaveState } from "./quota-order-state";
import type { QuotaCard } from "./quota-state";

/** The cards of the quota page in the person's order, and how that order is kept. */
export interface SortedQuotaCards {
  /**
   * The cards in display order; `null` while the connections or the stored
   * order are unknown, so the page never shows the default order first and
   * then jumps.
   */
  readonly cards: readonly QuotaCard[] | null;
  readonly saveState: QuotaOrderSaveState;
  /** Whether the stored order could not be read, so the default order stands. */
  readonly hasLoadFailed: boolean;
  /** Puts a card at a position and stores the new order. */
  readonly move: (connectionId: string, toIndex: number) => void;
  /** Stores the order on show again after a failed store. */
  readonly retrySave: () => void;
  /** Shows the order the server has stored instead of the one that failed. */
  readonly restoreSaved: () => void;
}

/**
 * The order of the quota cards: read from the account, applied to the cards,
 * and stored when the person moves a card.
 * @param cards - The cards of the page in the order the server listed them,
 * or `null` while the connections are unknown.
 * @returns The cards in the person's order and what moves and stores it.
 * @remarks
 * The order is separate from the cards: a list, a query or the push of the
 * minute changes figures and cards but never the order, so nothing falls back
 * to the default order. A card the order does not name stands at the end, and
 * a name without a card is skipped, so a connection that came or went never
 * stops the sorting. A move stores the whole visible order at once; a failed
 * store keeps the new order on show and offers to store it again or to show
 * the stored one.
 */
export function useQuotaCardOrder(
  cards: readonly QuotaCard[] | null,
): SortedQuotaCards {
  const [state, dispatch] = useReducer(
    reduceQuotaOrder,
    INITIAL_QUOTA_ORDER_STATE,
  );
  const [requests] = useState(() => new QuotaOrderRequests(dispatch));

  useEffect(() => {
    requests.load();
    return () => requests.abort();
  }, [requests]);

  const sorted =
    cards !== null && state.isLoaded
      ? orderQuotaCards(cards, state.order)
      : null;

  function move(connectionId: string, toIndex: number): void {
    if (sorted === null) return;
    const shown = sorted.map((card) => card.account.connectionId);
    const moved = moveConnectionId(shown, connectionId, toIndex);
    if (moved === shown) return;
    dispatch({ type: "changed", order: moved });
    requests.save(moved);
  }

  function retrySave(): void {
    dispatch({ type: "changed", order: state.order });
    requests.save(state.order);
  }

  return {
    cards: sorted,
    saveState: state.saveState,
    hasLoadFailed: state.hasLoadFailed,
    move,
    retrySave,
    restoreSaved: () => dispatch({ type: "restored" }),
  };
}
