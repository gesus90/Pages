import type { Dispatch, RefObject, SetStateAction } from "react";
import type { QuotaCard } from "./quota-state";
import type { QuotaSortAnnouncer } from "./use-quota-sort-announcement";

/** Selects the element of every card in the grid; the sorting reads their places. */
export const SORTABLE_CARD_SELECTOR = "[data-sortable-card]";

/** What moves the card: a pointer (mouse, finger, pen) or the keyboard. */
export type QuotaSortSource = "pointer" | "keyboard";

/** A card the person has picked up and the position it would take. */
export interface QuotaSortSession {
  readonly activeId: string;
  /** The position the card takes when it is put down. */
  readonly targetIndex: number;
  readonly source: QuotaSortSource;
}

/**
 * The newest cards and handlers, for the callbacks of a drag that lives
 * longer than the render that started it.
 */
export interface QuotaSortLatest {
  readonly cards: readonly QuotaCard[];
  readonly onMove: (connectionId: string, toIndex: number) => void;
  readonly announce: QuotaSortAnnouncer["announce"];
}

/** What the pointer and the keyboard sorting of the quota cards share. */
export interface QuotaSortContext {
  readonly gridRef: RefObject<HTMLDivElement | null>;
  /** The connections in display order. */
  readonly connectionIds: readonly string[];
  readonly session: QuotaSortSession | null;
  readonly setSession: Dispatch<SetStateAction<QuotaSortSession | null>>;
  /** Puts the card in hand down at a place, or back when the place is `null`. */
  readonly putDown: (connectionId: string, targetIndex: number | null) => void;
  readonly announce: QuotaSortAnnouncer["announce"];
  readonly latest: RefObject<QuotaSortLatest>;
}

/** What a key does at the handle of a card. */
export type KeyboardSortStep =
  | { readonly kind: "ignore" }
  | { readonly kind: "pickUp" }
  | { readonly kind: "drop" }
  | { readonly kind: "cancel" }
  | { readonly kind: "move"; readonly index: number };

/** Where the keyboard stands at the handle of a card. */
export interface KeyboardSortPosition {
  /** Whether the card is picked up by the keyboard. */
  readonly isGrabbed: boolean;
  /** The position of the card, or its target while picked up. */
  readonly targetIndex: number;
  /** How many cards stand in the grid. */
  readonly count: number;
}

function moveStep(index: number, count: number): KeyboardSortStep {
  return { kind: "move", index: Math.min(Math.max(index, 0), count - 1) };
}

/**
 * What a key does at the handle of a card.
 * @param key - The `key` of the keyboard event.
 * @param position - Where the keyboard stands.
 * @returns Enter or Space picks the card up and puts it down; the arrow
 * keys move the target one place, Home and End to the first and last place;
 * Escape puts the card back. Every other key, and every key but Enter and
 * Space while no card is picked up, is left to the browser.
 */
export function keyboardSortStep(
  key: string,
  position: KeyboardSortPosition,
): KeyboardSortStep {
  const isActivation = key === "Enter" || key === " ";
  if (!position.isGrabbed)
    return isActivation ? { kind: "pickUp" } : { kind: "ignore" };
  const { targetIndex, count } = position;
  switch (key) {
    case "Enter":
    case " ":
      return { kind: "drop" };
    case "Escape":
      return { kind: "cancel" };
    case "ArrowLeft":
    case "ArrowUp":
      return moveStep(targetIndex - 1, count);
    case "ArrowRight":
    case "ArrowDown":
      return moveStep(targetIndex + 1, count);
    case "Home":
      return moveStep(0, count);
    case "End":
      return moveStep(count - 1, count);
    default:
      return { kind: "ignore" };
  }
}
