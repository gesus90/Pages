import { Trash2, Upload } from "lucide-react";
import { useRef } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";

import type { StorageActionsModel } from "./use-storage-actions";

interface StorageActionToolbarProps {
  readonly actions: StorageActionsModel;
  /** Whether the shown folder takes uploads right now. */
  readonly canAddHere: boolean;
  readonly isTrashOpen: boolean;
  readonly onToggleTrash: () => void;
}

/**
 * Upload and the trash beside the list; the file actions of the list are in
 * its menu bar (PAGE-272).
 */
export function StorageActionToolbar({
  actions,
  canAddHere,
  isTrashOpen,
  onToggleTrash,
}: StorageActionToolbarProps): React.ReactElement {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isAddDisabled = !canAddHere || isTrashOpen || actions.isBusy;

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0];

    // Clearing the field lets the same file be chosen again after a conflict.
    event.target.value = "";

    if (file) actions.upload(file);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        disabled={isAddDisabled}
        onClick={() => fileInputRef.current?.click()}
        size="xs"
        type="button"
        variant="outline"
      >
        <Upload aria-hidden="true" className="size-3.5" />
        {t("storage.actions.upload")}
      </Button>
      <input
        aria-hidden="true"
        className="hidden"
        onChange={handleFileChange}
        ref={fileInputRef}
        tabIndex={-1}
        type="file"
      />
      <Button
        aria-pressed={isTrashOpen}
        onClick={onToggleTrash}
        size="xs"
        type="button"
        variant={isTrashOpen ? "default" : "ghost"}
      >
        <Trash2 aria-hidden="true" className="size-3.5" />
        {t(isTrashOpen ? "storage.trash.close" : "storage.trash.open")}
      </Button>
    </div>
  );
}
