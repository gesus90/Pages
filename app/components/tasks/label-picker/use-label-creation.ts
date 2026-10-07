import { useEffect, useRef, useState } from "react";
import { useSubmit } from "react-router";

import { DEFAULT_LABEL_COLOR } from "@/definition/Task";

import type { Label } from "@/definition/Task";

/** What the creation form needs to know about the ticket and the catalog. */
export interface LabelCreationOptions {
  readonly workItemId: string;
  readonly labels: readonly Label[];
  readonly assignedLabelIds: ReadonlySet<string>;
}

/** The new-label form state and the actions that drive it. */
export interface LabelCreation {
  readonly isCreating: boolean;
  readonly newName: string;
  readonly newColor: string;
  readonly setNewName: (name: string) => void;
  readonly setNewColor: (color: string) => void;
  readonly startCreating: () => void;
  /** Discards the draft and closes the form. */
  readonly closeForm: () => void;
  readonly createLabel: () => void;
  /** Stops waiting for a created label to appear in the catalog. */
  readonly cancelPendingAssign: () => void;
}

/**
 * Keeps the new-label form and assigns a freshly created label to the ticket.
 *
 * @remarks
 * A freshly created label is selected for the current ticket once the
 * revalidated catalog contains it. Only ids unseen at creation time qualify,
 * so an unrelated label with the same name can never match.
 */
export function useLabelCreation({
  workItemId,
  labels,
  assignedLabelIds,
}: LabelCreationOptions): LabelCreation {
  const submit = useSubmit();
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState<string>(DEFAULT_LABEL_COLOR);
  const [pendingAssignName, setPendingAssignName] = useState<string | null>(
    null,
  );
  const knownLabelIds = useRef<ReadonlySet<string>>(new Set());

  useEffect(() => {
    if (!pendingAssignName) {
      return;
    }

    const created = labels.find(
      (label) =>
        label.name.toLowerCase() === pendingAssignName.toLowerCase() &&
        !knownLabelIds.current.has(label.id) &&
        !assignedLabelIds.has(label.id),
    );

    if (created) {
      setPendingAssignName(null);
      // The form stays open until the label exists, so a rejected name can be corrected.
      setIsCreating(false);
      setNewName("");
      setNewColor(DEFAULT_LABEL_COLOR);
      void submit(
        { intent: "label-assign", labelId: created.id, workItemId },
        { method: "post" },
      );
    }
  }, [pendingAssignName, labels, assignedLabelIds, submit, workItemId]);

  function startCreating(): void {
    setIsCreating(true);
  }

  function closeForm(): void {
    setIsCreating(false);
    setNewName("");
    setNewColor(DEFAULT_LABEL_COLOR);
  }

  function createLabel(): void {
    const name = newName.trim();

    knownLabelIds.current = new Set(labels.map((label) => label.id));
    void submit(
      { color: newColor, intent: "label-create", name },
      { method: "post" },
    );
    setPendingAssignName(name);
  }

  function cancelPendingAssign(): void {
    setPendingAssignName(null);
  }

  return {
    cancelPendingAssign,
    closeForm,
    createLabel,
    isCreating,
    newColor,
    newName,
    setNewColor,
    setNewName,
    startCreating,
  };
}
