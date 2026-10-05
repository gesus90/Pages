import { useState } from "react";
import { useSubmit } from "react-router";

import type { WorkItemChecklistItem } from "@/definition/Task";

/** The draft of a new checklist item and the actions that change the list. */
export interface ChecklistActions {
  readonly newTitle: string;
  readonly setNewTitle: (title: string) => void;
  readonly toggleItem: (item: WorkItemChecklistItem) => void;
  readonly deleteItem: (item: WorkItemChecklistItem) => void;
  /** Adds the drafted title as a new item; a blank draft is ignored. */
  readonly addItem: () => void;
}

/**
 * Keeps the new-item draft and submits checklist changes of a ticket.
 *
 * @param workItemId - The ticket new items are added to.
 */
export function useChecklistActions(workItemId: string): ChecklistActions {
  const submit = useSubmit();
  const [newTitle, setNewTitle] = useState("");

  function toggleItem(item: WorkItemChecklistItem): void {
    void submit(
      {
        checklistItemId: item.id,
        intent: "checklist-toggle",
        isDone: item.isDone ? "false" : "true",
      },
      { method: "post" },
    );
  }

  function deleteItem(item: WorkItemChecklistItem): void {
    void submit(
      { checklistItemId: item.id, intent: "checklist-delete" },
      { method: "post" },
    );
  }

  function addItem(): void {
    const title = newTitle.trim();

    if (!title) {
      return;
    }

    void submit(
      { intent: "checklist-add", title, workItemId },
      { method: "post" },
    );
    setNewTitle("");
  }

  return { addItem, deleteItem, newTitle, setNewTitle, toggleItem };
}
