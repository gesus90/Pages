import { useState } from "react";

import {
  computeDropSortOrder,
  computeInsertIndex,
} from "./kanban-drop-position";

import type { WorkItemDetail } from "@/definition/Task";

/** Drag state of the kanban board and the handlers that change it. */
export interface KanbanDrag {
  /** The ticket being dragged, `null` outside of a drag. */
  readonly draggedTaskId: string | null;
  /** The column under the pointer, `null` when no column is hovered. */
  readonly dragOverStatusId: string | null;
  /** Insertion index inside the hovered column, `-1` when unknown. */
  readonly dragOverIndex: number;
  readonly handleDragStart: (
    event: React.DragEvent<HTMLElement>,
    taskId: string,
  ) => void;
  readonly handleDragEnd: () => void;
  readonly handleDragOver: (
    event: React.DragEvent<HTMLElement>,
    statusId: string,
  ) => void;
  readonly handleDragLeave: (
    event: React.DragEvent<HTMLElement>,
    statusId: string,
  ) => void;
  readonly handleDrop: (
    event: React.DragEvent<HTMLElement>,
    statusId: string,
  ) => void;
}

/**
 * Keeps the drag-and-drop state of the kanban board.
 *
 * @param workItems - All tickets of the board, used to order a dropped ticket.
 * @param onMoveTask - Called with the target column and sort order of a drop.
 */
export function useKanbanDrag(
  workItems: readonly WorkItemDetail[],
  onMoveTask: (
    taskId: string,
    targetStatusId: string,
    sortOrder: number,
  ) => void,
): KanbanDrag {
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [dragOverStatusId, setDragOverStatusId] = useState<string | null>(null);
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
    setDragOverStatusId(null);
    setDragOverIndex(-1);
  }

  function handleDragOver(
    event: React.DragEvent<HTMLElement>,
    statusId: string,
  ): void {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";

    if (dragOverStatusId !== statusId) {
      setDragOverStatusId(statusId);
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
    statusId: string,
  ): void {
    const nextTarget = event.relatedTarget;

    if (
      nextTarget instanceof Node &&
      event.currentTarget.contains(nextTarget)
    ) {
      return;
    }

    if (dragOverStatusId === statusId) {
      setDragOverStatusId(null);
      setDragOverIndex(-1);
    }
  }

  function handleDrop(
    event: React.DragEvent<HTMLElement>,
    statusId: string,
  ): void {
    event.preventDefault();
    setDragOverStatusId(null);
    setDragOverIndex(-1);

    const taskId = event.dataTransfer.getData("text/plain") || draggedTaskId;

    if (!taskId) {
      return;
    }

    const insertIndex = computeInsertIndex(event.currentTarget, event.clientY);
    const columnItems = workItems.filter((item) => item.statusId === statusId);

    onMoveTask(
      taskId,
      statusId,
      computeDropSortOrder(columnItems, taskId, insertIndex),
    );
    setDraggedTaskId(null);
  }

  return {
    dragOverIndex,
    dragOverStatusId,
    draggedTaskId,
    handleDragEnd,
    handleDragLeave,
    handleDragOver,
    handleDragStart,
    handleDrop,
  };
}
