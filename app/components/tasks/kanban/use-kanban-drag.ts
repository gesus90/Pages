import { useState } from "react";

import type { WorkItemDetail } from "@/definition/Task";

/** A column that accepts drops: its own id, the status it stands for and its tickets. */
export interface KanbanDropTarget {
  /** Unique on the board; one status has one column per group. */
  readonly id: string;
  readonly statusId: string;
  /** The tickets shown in the column, in display order. */
  readonly items: readonly WorkItemDetail[];
}

/** Drag state of the kanban board and the handlers that change it. */
export interface KanbanDrag {
  /** The ticket being dragged, `null` outside of a drag. */
  readonly draggedTaskId: string | null;
  /** The column under the pointer, `null` when no column is hovered. */
  readonly dragOverColumnId: string | null;
  /** Insertion index inside the hovered column, `-1` when unknown. */
  readonly dragOverIndex: number;
  readonly handleDragStart: (
    event: React.DragEvent<HTMLElement>,
    taskId: string,
  ) => void;
  readonly handleDragEnd: () => void;
  readonly handleDragOver: (
    event: React.DragEvent<HTMLElement>,
    target: KanbanDropTarget,
  ) => void;
  readonly handleDragLeave: (
    event: React.DragEvent<HTMLElement>,
    target: KanbanDropTarget,
  ) => void;
  readonly handleDrop: (
    event: React.DragEvent<HTMLElement>,
    target: KanbanDropTarget,
  ) => void;
}

// Die eingeblendete Ghost-Karte verschiebt alle nachfolgenden Karten nach
// unten. Ohne Korrektur würde die Vorschau deshalb zwischen zwei Positionen
// hin- und herspringen, sobald der Zeiger nahe einer Kartenmitte steht. Die
// Verschiebung wird aus dem tatsächlichen Abstand zwischen Ghost und
// Folgekarte gemessen und wieder herausgerechnet.
function computeInsertIndex(column: HTMLElement, clientY: number): number {
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

// A ticket moved inside its own column leaves its old slot first, so every
// insertion index behind that slot is one too high.
function computeDropSortOrder(
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

/**
 * Keeps the drag-and-drop state of the kanban board.
 * @param onMoveTask - Called with the target column and sort order of a drop.
 */
export function useKanbanDrag(
  onMoveTask: (
    taskId: string,
    targetStatusId: string,
    sortOrder: number,
  ) => void,
): KanbanDrag {
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [dragOverColumnId, setDragOverColumnId] = useState<string | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number>(-1);

  function handleDragStart(
    event: React.DragEvent<HTMLElement>,
    taskId: string,
  ): void {
    setDraggedTaskId(taskId);
    event.dataTransfer.setData("text/plain", taskId);
    event.dataTransfer.effectAllowed = "move";
  }

  function handleDragEnd(): void {
    setDraggedTaskId(null);
    setDragOverColumnId(null);
    setDragOverIndex(-1);
  }

  function handleDragOver(
    event: React.DragEvent<HTMLElement>,
    target: KanbanDropTarget,
  ): void {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";

    if (dragOverColumnId !== target.id) {
      setDragOverColumnId(target.id);
    }

    if (!draggedTaskId) {
      return;
    }

    const insertIndex = computeInsertIndex(event.currentTarget, event.clientY);

    if (insertIndex !== dragOverIndex) {
      setDragOverIndex(insertIndex);
    }
  }

  function handleDragLeave(
    event: React.DragEvent<HTMLElement>,
    target: KanbanDropTarget,
  ): void {
    const nextTarget = event.relatedTarget;

    if (
      nextTarget instanceof Node &&
      event.currentTarget.contains(nextTarget)
    ) {
      return;
    }

    if (dragOverColumnId === target.id) {
      setDragOverColumnId(null);
      setDragOverIndex(-1);
    }
  }

  function handleDrop(
    event: React.DragEvent<HTMLElement>,
    target: KanbanDropTarget,
  ): void {
    event.preventDefault();
    setDragOverColumnId(null);
    setDragOverIndex(-1);

    const taskId = event.dataTransfer.getData("text/plain") || draggedTaskId;

    if (!taskId) {
      return;
    }

    const insertIndex = computeInsertIndex(event.currentTarget, event.clientY);

    onMoveTask(
      taskId,
      target.statusId,
      computeDropSortOrder(target.items, taskId, insertIndex),
    );
    setDraggedTaskId(null);
  }

  return {
    dragOverIndex,
    dragOverColumnId,
    draggedTaskId,
    handleDragEnd,
    handleDragLeave,
    handleDragOver,
    handleDragStart,
    handleDrop,
  };
}
