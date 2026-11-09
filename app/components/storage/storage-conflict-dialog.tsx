import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/app/components/ui/dialog";

import type { StorageEntry } from "@/definition/GoogleDriveFiles";
import type { ReactNode } from "react";

interface StorageConflictDialogProps {
  readonly isOpen: boolean;
  /** The entries that already carry the name. */
  readonly conflicts: readonly StorageEntry[];
  /** Only an upload may replace the existing file. */
  readonly canReplace: boolean;
  readonly isBusy: boolean;
  readonly error: ReactNode;
  readonly onKeepBoth: () => void;
  readonly onReplace: () => void;
  readonly onCancel: () => void;
}

/**
 * Asks what happens when the target folder already holds an entry of the
 * same name: keep both, replace the file (uploads only) or cancel.
 */
export function StorageConflictDialog({
  isOpen,
  conflicts,
  canReplace,
  isBusy,
  error,
  onKeepBoth,
  onReplace,
  onCancel,
}: StorageConflictDialogProps): React.ReactElement {
  const { t } = useTranslation();
  const name = conflicts[0]?.name ?? "";
  // Replacing reaches exactly one existing file, never a folder.
  const isReplaceable =
    canReplace && conflicts.length === 1 && conflicts[0]?.isFolder === false;

  function handleOpenChange(open: boolean): void {
    if (!open) onCancel();
  }

  return (
    <Dialog onOpenChange={handleOpenChange} open={isOpen}>
      <DialogContent>
        <DialogTitle className="text-lg font-semibold">
          {t("storage.conflict.title")}
        </DialogTitle>
        <DialogDescription className="mt-3 text-sm leading-relaxed text-muted-foreground">
          {name === ""
            ? t("storage.conflict.textUnnamed")
            : t("storage.conflict.text", { name })}
        </DialogDescription>
        {error ? <div className="mt-3">{error}</div> : null}
        <footer className="mt-6 flex flex-wrap justify-end gap-2">
          <Button onClick={onCancel} type="button" variant="ghost">
            {t("storage.actions.cancel")}
          </Button>
          {isReplaceable ? (
            <Button
              disabled={isBusy}
              onClick={onReplace}
              type="button"
              variant="destructive-soft"
            >
              {t("storage.conflict.replace")}
            </Button>
          ) : null}
          <Button isPending={isBusy} onClick={onKeepBoth} type="button">
            {t("storage.conflict.keepBoth")}
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
