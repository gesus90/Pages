import type { WorkItemDetail } from "@/definition/Task";

/**
 * Resolves the 0-based insertion index within a column's ticket list based on
 * the pointer's vertical position.
 *
 * @remarks
 * Die eingeblendete Ghost-Karte verschiebt alle nachfolgenden Karten nach
 * unten. Ohne Korrektur würde die Vorschau deshalb zwischen zwei Positionen
 * hin- und herspringen, sobald der Zeiger nahe einer Kartenmitte steht. Die
 * Verschiebung wird aus dem tatsächlichen Abstand zwischen Ghost und
 * Folgekarte gemessen und wieder herausgerechnet.
 */
export function computeInsertIndex(
  column: HTMLElement,
  clientY: number,
): number {
  const cards = Array.from(
    column.querySelectorAll<HTMLElement>("[data-ticket-item]"),
  );
  const ghost = column.querySelector<HTMLElement>("[data-drop-ghost]");
  const ghostTop = ghost ? ghost.getBoundingClientRect().top : null;
  const cardTops = cards.map((card) => card.getBoundingClientRect().top);

  let ghostShift = 0;

  if (ghostTop !== null) {
    const nextCardTop = cardTops.find((top) => top > ghostTop);
    ghostShift = nextCardTop === undefined ? 0 : nextCardTop - ghostTop;
  }

  for (let index = 0; index < cards.length; index += 1) {
    const rect = cards[index].getBoundingClientRect();
    const top =
      ghostTop !== null && rect.top > ghostTop
        ? rect.top - ghostShift
        : rect.top;

    if (clientY < top + rect.height / 2) {
      return index;
    }
  }

  return cards.length;
}

/**
 * Resolves the 1-based sort order a dropped ticket takes in its target column.
 *
 * @param columnItems - Tickets currently in the target column.
 * @param taskId - The dropped ticket.
 * @param insertIndex - Insertion index measured by {@link computeInsertIndex}.
 *
 * @remarks
 * A ticket moved inside its own column leaves its old slot first, so every
 * insertion index behind that slot is one too high.
 */
export function computeDropSortOrder(
  columnItems: readonly WorkItemDetail[],
  taskId: string,
  insertIndex: number,
): number {
  const draggedIndexInColumn = columnItems.findIndex(
    (item) => item.id === taskId,
  );

  if (draggedIndexInColumn === -1) {
    return insertIndex + 1;
  }

  const slotIndex =
    insertIndex <= draggedIndexInColumn ? insertIndex : insertIndex - 1;

  return slotIndex + 1;
}
