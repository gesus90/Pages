import { useState } from "react";
import { useSubmit } from "react-router";

import { DEFAULT_LABEL_COLOR } from "@/definition/Task";

import type { Label } from "@/definition/Task";

/** The edit form and delete confirmation of one label row at a time. */
export interface LabelEditing {
  readonly editingId: string | null;
  readonly editName: string;
  readonly editColor: string;
  readonly confirmDeleteId: string | null;
  readonly setEditName: (name: string) => void;
  readonly setEditColor: (color: string) => void;
  readonly startEdit: (label: Label) => void;
  readonly saveEdit: (label: Label) => void;
  readonly cancelEdit: () => void;
  /** Asks for confirmation first and deletes the label on the second call. */
  readonly deleteLabel: (label: Label) => void;
  readonly cancelDelete: () => void;
}

/** Keeps the label being edited and submits its update or deletion. */
export function useLabelEditing(): LabelEditing {
  const submit = useSubmit();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState<string>(DEFAULT_LABEL_COLOR);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  function startEdit(label: Label): void {
    setEditingId(label.id);
    setEditName(label.name);
    setEditColor(label.color);
    setConfirmDeleteId(null);
  }

  function saveEdit(label: Label): void {
    const name = editName.trim();

    void submit(
      { color: editColor, intent: "label-update", labelId: label.id, name },
      { method: "post" },
    );
    setEditingId(null);
  }

  function cancelEdit(): void {
    setEditingId(null);
    setConfirmDeleteId(null);
  }

  function deleteLabel(label: Label): void {
    if (confirmDeleteId !== label.id) {
      setConfirmDeleteId(label.id);
      return;
    }

    void submit(
      { intent: "label-delete", labelId: label.id },
      { method: "post" },
    );
    cancelEdit();
  }

  function cancelDelete(): void {
    setConfirmDeleteId(null);
  }

  return {
    cancelDelete,
    cancelEdit,
    confirmDeleteId,
    deleteLabel,
    editColor,
    editName,
    editingId,
    saveEdit,
    setEditColor,
    setEditName,
    startEdit,
  };
}
