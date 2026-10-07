import { useState } from "react";

import {
  computeDropSortOrder,
  computeInsertIndex,
} from "./kanban-drop-position";

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

/**
 * Keeps the drag-and-drop state of the kanban board.
 *
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
