import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/app/components/ui/dialog";

import {
  StorageActionError,
  storageErrorMessage,
} from "./storage-action-notices";
import { Notice } from "./storage-notices";

import type { StorageErrorCode } from "@/definition/GoogleDriveFiles";

import type {
  StorageBatchModel,
  StorageBatchOutcome,
} from "./use-storage-batch";

/** At most this many names are listed per reason; the count names the rest. */
const LISTED_NAMES = 5;

interface RefusalGroup {
  readonly code: StorageErrorCode;
  readonly names: readonly string[];
}

function groupRefusals(outcome: StorageBatchOutcome): RefusalGroup[] {
  const groups = new Map<StorageErrorCode, string[]>();

  for (const failure of outcome.failures) {
    const names = groups.get(failure.code) ?? [];

    names.push(failure.entry.name);
    groups.set(failure.code, names);
  }

  return [...groups].map(([code, names]) => ({ code, names }));
}

function OutcomeNotice({
  outcome,
  onDismiss,
}: {
  readonly outcome: StorageBatchOutcome;
  readonly onDismiss: () => void;
}): React.ReactElement {
  const { t, i18n } = useTranslation();
  const refused = outcome.failures.length;
  const done = t(`storage.batch.done.${outcome.action}`, {
    count: outcome.succeeded,
  });

  return (
    <Notice
      actions={
        <Button onClick={onDismiss} size="sm" type="button" variant="ghost">
          {t("storage.actions.dismiss")}
        </Button>
      }
      title={
        refused === 0
          ? done
          : t("storage.batch.partly", { count: refused, done })
      }
      tone={refused === 0 ? "info" : "warning"}
    >
      {refused === 0 ? null : (
        <ul className="flex list-disc flex-col gap-1 pl-5">
          {groupRefusals(outcome).map((group) => (
            <li key={group.code}>
              {t("storage.batch.reason", {
                count: group.names.length,
                names: group.names.slice(0, LISTED_NAMES).join(", "),
                reason: storageErrorMessage(
                  { code: group.code },
                  t,
                  i18n.language,
                ),
              })}
              {group.names.length > LISTED_NAMES
                ? ` ${t("storage.batch.more", { count: group.names.length - LISTED_NAMES })}`
                : null}
            </li>
          ))}
        </ul>
      )}
    </Notice>
  );
}

/**
 * The outcome of the last batch action: how many entries changed, and how
 * many were refused with their reasons (PAGE-272).
 */
export function StorageBatchNotices({
  batch,
}: {
  readonly batch: StorageBatchModel;
}): React.ReactElement | null {
  if (batch.error !== null) {
    return <StorageActionError error={batch.error} onDismiss={batch.dismiss} />;
  }

  return batch.outcome === null ? null : (
    <OutcomeNotice onDismiss={batch.dismiss} outcome={batch.outcome} />
  );
}

/** Asks before the selection moves to the trash of Google Drive. */
export function StorageTrashDialog({
  batch,
}: {
  readonly batch: StorageBatchModel;
}): React.ReactElement {
  const { t } = useTranslation();
  const entries = batch.pendingTrash ?? [];
  const folders = entries.filter((entry) => entry.isFolder).length;

  function handleOpenChange(isOpen: boolean): void {
    if (!isOpen) batch.cancelTrash();
  }

  return (
    <Dialog onOpenChange={handleOpenChange} open={batch.pendingTrash !== null}>
      <DialogContent>
        <DialogTitle className="text-lg font-semibold">
          {t("storage.batch.trash.title", { count: entries.length })}
        </DialogTitle>
        <DialogDescription className="mt-2 text-sm text-muted-foreground">
          {t("storage.batch.trash.text")}
          {folders > 0
            ? ` ${t("storage.batch.trash.folders", { count: folders })}`
            : null}
        </DialogDescription>
        <ul className="mt-3 max-h-48 overflow-y-auto rounded-lg bg-muted px-3 py-2 text-sm">
          {entries.map((entry) => (
            <li className="truncate" key={entry.ref}>
              {entry.name === "" ? t("storage.untitled") : entry.name}
            </li>
          ))}
        </ul>
        <footer className="mt-5 flex justify-end gap-2">
          <Button onClick={batch.cancelTrash} type="button" variant="ghost">
            {t("storage.actions.cancel")}
          </Button>
          <Button
            onClick={batch.confirmTrash}
            type="button"
            variant="destructive"
          >
            {t("storage.batch.trash.confirm")}
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
