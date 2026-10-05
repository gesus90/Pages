import { useEffect, useState } from "react";

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
 * Keeps the dialog state of a ticket panel and closes the panel with Escape.
 *
 * @param onClose - Closes the panel; called for an Escape that nobody handled.
 */
export function useDetailPanelState(onClose: () => void): DetailPanelState {
  const [isLabelPickerOpen, setIsLabelPickerOpen] = useState(false);
  const [isMoveDialogOpen, setIsMoveDialogOpen] = useState(false);
  const [pendingProjectId, setPendingProjectId] = useState("");

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape" && !event.defaultPrevented) {
        onClose();
      }
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

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
