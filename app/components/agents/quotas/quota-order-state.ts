import { isSameQuotaOrder } from "./quota-card-order";

/** Where the order a person arranged stands: stored, on its way, or not stored. */
export type QuotaOrderSaveState = "saved" | "saving" | "failed";

/** What the quota page knows about the order of its cards. */
export interface QuotaOrderState {
  /** Whether the stored order has answered, or its request failed. */
  readonly isLoaded: boolean;
  /** Whether the stored order could not be read, so the default order stands. */
  readonly hasLoadFailed: boolean;
  /** The connection IDs the page shows, first card first. */
  readonly order: readonly string[];
  /** The connection IDs as far as the server stored them. */
  readonly savedOrder: readonly string[];
  readonly saveState: QuotaOrderSaveState;
}

/** Everything that changes the order. */
export type QuotaOrderAction =
  | { readonly type: "loaded"; readonly order: readonly string[] }
  | { readonly type: "loadFailed" }
  | { readonly type: "changed"; readonly order: readonly string[] }
  | { readonly type: "saved"; readonly order: readonly string[] }
  | { readonly type: "saveFailed" }
  | { readonly type: "restored" };

/** The state of a page that has asked for nothing yet: the default order. */
export const INITIAL_QUOTA_ORDER_STATE: QuotaOrderState = {
  isLoaded: false,
  hasLoadFailed: false,
  order: [],
  savedOrder: [],
  saveState: "saved",
};

/**
 * The state after an action.
 * @param state - The state before.
 * @param action - What happened.
 * @returns The new state. A saved order that is not the one on show leaves
 * the state at "saving", because a newer order is on its way.
 */
export function reduceQuotaOrder(
  state: QuotaOrderState,
  action: QuotaOrderAction,
): QuotaOrderState {
  switch (action.type) {
    case "loaded":
      return {
        ...state,
        isLoaded: true,
        hasLoadFailed: false,
        order: action.order,
        savedOrder: action.order,
      };
    case "loadFailed":
      return { ...state, isLoaded: true, hasLoadFailed: true };
    case "changed":
      return { ...state, order: action.order, saveState: "saving" };
    case "saved":
      // A stored order is known from now on, whether or not it could be read.
      return {
        ...state,
        hasLoadFailed: false,
        savedOrder: action.order,
        saveState: isSameQuotaOrder(state.order, action.order)
          ? "saved"
          : "saving",
      };
    case "saveFailed":
      return { ...state, saveState: "failed" };
    case "restored":
      return { ...state, order: state.savedOrder, saveState: "saved" };
  }
}
