import { useState } from "react";

/** Open states of the dialogs a ticket panel can show. */
export interface DetailPanelState {
  readonly isLabelPickerOpen: boolean;
  readonly isMoveDialogOpen: boolean;
  /** The project the visitor picked for moving the ticket, empty otherwise. */
  readonly pendingProjectId: string;
  readonly setIsLabelPickerOpen: (isOpen: boolean) => void;
  readonly openMoveDialog: (projectId: string) => void;
  readonly closeMoveDialog: () => void;
}

/**
 * Keeps the dialog state of a ticket panel.
 */
export function useDetailPanelState(): DetailPanelState {
  const [isLabelPickerOpen, setIsLabelPickerOpen] = useState(false);
  const [isMoveDialogOpen, setIsMoveDialogOpen] = useState(false);
  const [pendingProjectId, setPendingProjectId] = useState("");

  function openMoveDialog(projectId: string): void {
    setPendingProjectId(projectId);
    setIsMoveDialogOpen(true);
  }

  function closeMoveDialog(): void {
    setIsMoveDialogOpen(false);
    setPendingProjectId("");
  }

  return {
    closeMoveDialog,
    isLabelPickerOpen,
    isMoveDialogOpen,
    openMoveDialog,
    pendingProjectId,
    setIsLabelPickerOpen,
  };
}
