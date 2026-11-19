import type { QuotaCard } from "./quota-state";

/**
 * The cards in the order a person arranged them.
 * @param cards - The cards in the order the server listed them.
 * @param order - The stored connection IDs, first card first.
 * @returns The cards named in `order` first, in that order, then every other
 * card in the order the server listed it.
 * @remarks
 * A card the person never placed stands at the end, and an ID of `order`
 * without a card, such as a connection the person may not use any more, is
 * skipped. Without an order the cards keep the order of the server.
 */
export function orderQuotaCards(
  cards: readonly QuotaCard[],
  order: readonly string[],
): readonly QuotaCard[] {
  const positions = new Map(
    order.map((id, index): [string, number] => [id, index]),
  );
  const placed: QuotaCard[] = [];
  const added: QuotaCard[] = [];
  for (const card of cards) {
    if (positions.has(card.account.connectionId)) placed.push(card);
    else added.push(card);
  }
  placed.sort(
    (first, second) =>
      (positions.get(first.account.connectionId) ?? 0) -
      (positions.get(second.account.connectionId) ?? 0),
  );
  return [...placed, ...added];
}

/**
 * Moves one connection to a position of the order.
 * @param connectionIds - The connection IDs in display order.
 * @param connectionId - The connection to move.
 * @param toIndex - The position it takes; a position outside the list is
 * the nearest end.
 * @returns A new order, or `connectionIds` itself when the connection stays
 * where it is or is not in the list.
 */
export function moveConnectionId(
  connectionIds: readonly string[],
  connectionId: string,
  toIndex: number,
): readonly string[] {
  const fromIndex = connectionIds.indexOf(connectionId);
  const targetIndex = Math.min(Math.max(toIndex, 0), connectionIds.length - 1);
  if (fromIndex === -1 || fromIndex === targetIndex) return connectionIds;
  const moved = connectionIds.filter((id) => id !== connectionId);
  moved.splice(targetIndex, 0, connectionId);
  return moved;
}

/**
 * Whether two orders name the same connections in the same sequence.
 * @param first - One order.
 * @param second - The other order.
 */
export function isSameQuotaOrder(
  first: readonly string[],
  second: readonly string[],
): boolean {
  return (
    first.length === second.length &&
    first.every((id, index) => id === second[index])
  );
}
