import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/app/components/ui/dialog";

import { formatBytes } from "./storage-format";

import type {
  StorageConfirmation,
  StorageScope,
} from "@/definition/GoogleDriveFiles";
import type { ReactNode } from "react";

interface StorageConfirmDialogProps {
  readonly confirmation: StorageConfirmation | null;
  /** Set when the object changed and the server issued a new confirmation. */
  readonly isRefreshed: boolean;
  readonly isBusy: boolean;
  /** The failure of the last attempt, shown inside the dialog. */
  readonly error: ReactNode;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

function ScopeSummary({
  scope,
}: {
  readonly scope: StorageScope;
}): React.ReactElement {
  const { t, i18n } = useTranslation();

  return (
    <div className="mt-3 rounded-xl bg-muted px-4 py-3 text-sm text-foreground">
      <p>
        {t("storage.confirm.scope", {
          files: t("storage.confirm.fileCount", { count: scope.fileCount }),
          folders: t("storage.confirm.folderCount", {
            count: scope.folderCount,
          }),
          size: formatBytes(scope.totalBytes, i18n.language),
        })}
      </p>
      {scope.isTruncated ? (
        <p className="mt-1 text-muted-foreground">
          {t("storage.confirm.truncated")}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Asks before a destructive Storage action: moving a folder to the trash,
 * deleting permanently or overwriting a file (PAGE-270).
 *
 * @remarks
 * It shows the target, the action and, for a folder, the reached scope the
 * server counted. When the object changed meanwhile, the server issues a new
 * confirmation; the dialog then shows the new state and says why.
 */
export function StorageConfirmDialog({
  confirmation,
  isRefreshed,
  isBusy,
  error,
  onConfirm,
  onCancel,
}: StorageConfirmDialogProps): React.ReactElement {
  const { t } = useTranslation();
  const action = confirmation?.action ?? "delete";
  const name = confirmation?.target.name ?? "";

  function handleOpenChange(isOpen: boolean): void {
    if (!isOpen) onCancel();
  }

  return (
    <Dialog onOpenChange={handleOpenChange} open={confirmation !== null}>
      <DialogContent>
        <DialogTitle className="text-lg font-semibold">
          {t(`storage.confirm.title.${action}`)}
        </DialogTitle>
        <DialogDescription className="mt-3 text-sm leading-relaxed text-muted-foreground">
          {t(`storage.confirm.text.${action}`, {
            name: name === "" ? t("storage.untitled") : name,
          })}
        </DialogDescription>
        {isRefreshed ? (
          <p className="mt-3 text-sm text-warning" role="status">
            {t("storage.confirm.refreshed")}
          </p>
        ) : null}
        {confirmation?.scope ? (
          <ScopeSummary scope={confirmation.scope} />
        ) : null}
        {error ? <div className="mt-3">{error}</div> : null}
        <footer className="mt-6 flex justify-end gap-2">
          <Button onClick={onCancel} type="button" variant="ghost">
            {t("storage.actions.cancel")}
          </Button>
          <Button
            isPending={isBusy}
            onClick={onConfirm}
            type="button"
            variant="destructive"
          >
            {t(`storage.confirm.action.${action}`)}
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
