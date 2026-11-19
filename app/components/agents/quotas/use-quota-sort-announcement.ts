import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { QuotaCard } from "./quota-state";

/** What a screen reader hears while a card is sorted. */
export type QuotaSortAnnouncementKind =
  "pickedUp" | "moved" | "dropped" | "cancelled";

/** What the grid tells a screen reader about the sorting. */
export interface QuotaSortAnnouncer {
  /** The sentence the live region of the grid holds. */
  readonly announcement: string;
  /**
   * Announces what happened to a card.
   * @param kind - What happened.
   * @param connectionId - The connection of the card.
   * @param index - The zero-based position the card has or would take.
   */
  readonly announce: (
    kind: QuotaSortAnnouncementKind,
    connectionId: string,
    index: number,
  ) => void;
}

/**
 * The sentences a screen reader hears while a card is picked up, moved, put
 * down or put back.
 * @param cards - The cards in display order; they name the card and count the
 * positions.
 * @returns The current sentence and the function that sets the next.
 */
export function useQuotaSortAnnouncement(
  cards: readonly QuotaCard[],
): QuotaSortAnnouncer {
  const { t } = useTranslation();
  const [announcement, setAnnouncement] = useState("");

  function announce(
    kind: QuotaSortAnnouncementKind,
    connectionId: string,
    index: number,
  ): void {
    const card = cards.find(
      (entry) => entry.account.connectionId === connectionId,
    );
    if (!card) return;
    setAnnouncement(
      t(`agentsPage.order.announcement.${kind}`, {
        name: card.account.name,
        position: Math.min(index, cards.length - 1) + 1,
        count: cards.length,
      }),
    );
  }

  return { announcement, announce };
}
