import { File, Folder, Loader2, RotateCcw, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";

import { StorageActionError } from "./storage-action-notices";
import { formatBytes, formatModified } from "./storage-format";

import type { StorageEntry } from "@/definition/GoogleDriveFiles";

import type { StorageActionsModel } from "./use-storage-actions";
import type { StorageTrashModel } from "./use-storage-trash";

interface StorageTrashViewProps {
  readonly trash: StorageTrashModel;
  readonly actions: StorageActionsModel;
  readonly canWrite: boolean;
}

function TrashRow({
  entry,
  actions,
  canWrite,
}: {
  readonly entry: StorageEntry;
  readonly actions: StorageActionsModel;
  readonly canWrite: boolean;
}): React.ReactElement {
  const { t, i18n } = useTranslation();
  const Icon = entry.isFolder ? Folder : File;
  const name = entry.name === "" ? t("storage.untitled") : entry.name;

  return (
    <tr className="border-b border-border last:border-b-0 hover:bg-surface-hover">
      <td className="max-w-0 px-4 py-2">
        <span className="flex min-w-0 items-center gap-3 py-1">
          <Icon
            aria-hidden="true"
            className="size-5 shrink-0 text-muted-foreground"
          />
          <span className="truncate">{name}</span>
        </span>
      </td>
      <td className="hidden px-4 py-2 text-sm whitespace-nowrap text-muted-foreground md:table-cell">
        {entry.modifiedAt === null
          ? "—"
          : formatModified(entry.modifiedAt, i18n.language)}
      </td>
      <td className="hidden px-4 py-2 text-right text-sm whitespace-nowrap text-muted-foreground tabular-nums sm:table-cell">
        {entry.sizeBytes === null
          ? "—"
          : formatBytes(entry.sizeBytes, i18n.language)}
      </td>
      <td className="w-px px-2 py-2 whitespace-nowrap">
        {canWrite ? (
          <span className="flex justify-end gap-1">
            <Button
              disabled={actions.isBusy}
              onClick={() => actions.restore(entry)}
              size="xs"
              type="button"
              variant="ghost"
            >
              <RotateCcw aria-hidden="true" className="size-3.5" />
              {t("storage.trash.restore")}
            </Button>
            <Button
              disabled={actions.isBusy}
              onClick={() => actions.deletePermanently(entry)}
              size="xs"
              type="button"
              variant="destructive-soft"
            >
              <Trash2 aria-hidden="true" className="size-3.5" />
              {t("storage.trash.deletePermanently")}
            </Button>
          </span>
        ) : null}
      </td>
    </tr>
  );
}

function TrashTable({
  entries,
  actions,
  canWrite,
}: {
  readonly entries: readonly StorageEntry[];
} & Omit<StorageTrashViewProps, "trash">): React.ReactElement {
  const { t } = useTranslation();

  return (
    <table className="w-full table-fixed border-collapse text-left">
      <thead className="sticky top-0 z-10 bg-card">
        <tr className="border-b border-border text-xs font-medium text-muted-foreground uppercase">
          <th className="px-4 py-2.5 font-medium" scope="col">
            {t("storage.list.name")}
          </th>
          <th
            className="hidden w-48 px-4 py-2.5 font-medium md:table-cell"
            scope="col"
          >
            {t("storage.list.modified")}
          </th>
          <th
            className="hidden w-28 px-4 py-2.5 text-right font-medium sm:table-cell"
            scope="col"
          >
            {t("storage.list.size")}
          </th>
          <th className="w-72 px-2 py-2.5" scope="col">
            <span className="sr-only">{t("storage.list.actions")}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {entries.map((entry) => (
          <TrashRow
            actions={actions}
            canWrite={canWrite}
            entry={entry}
            key={entry.ref}
          />
        ))}
      </tbody>
    </table>
  );
}

function TrashFooter({
  trash,
  count,
  hasMore,
}: {
  readonly trash: StorageTrashModel;
  readonly count: number;
  readonly hasMore: boolean;
}): React.ReactElement {
  const { t } = useTranslation();

  return (
    <footer className="flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-2 text-xs text-muted-foreground">
      <span aria-live="polite">
        {t(hasMore ? "storage.list.countMore" : "storage.list.count", {
          count,
        })}
      </span>
      {hasMore ? (
        <Button
          isPending={trash.isLoadingMore}
          onClick={trash.loadMore}
          size="xs"
          type="button"
          variant="outline"
        >
          {t("storage.list.loadMore")}
        </Button>
      ) : null}
    </footer>
  );
}

/**
 * The trash of the connected Drive with restore and permanent deletion per
 * entry; the permanent deletion always asks for a confirmation first.
 */
export function StorageTrashView({
  trash,
  actions,
  canWrite,
}: StorageTrashViewProps): React.ReactElement {
  const { t } = useTranslation();
  const { reading } = trash;

  if (reading.kind === "loading") {
    return (
      <div className="flex min-h-48 flex-1 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
        <Loader2 aria-hidden="true" className="size-6 animate-spin" />
        <p role="status">{t("storage.trash.loading")}</p>
      </div>
    );
  }

  if (reading.kind === "failed") {
    return (
      <div className="p-4">
        <StorageActionError error={reading.error} />
      </div>
    );
  }

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {reading.entries.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-muted-foreground">
            {t("storage.trash.empty")}
          </p>
        ) : (
          <TrashTable
            actions={actions}
            canWrite={canWrite}
            entries={reading.entries}
          />
        )}
      </div>
      <TrashFooter
        count={reading.entries.length}
        hasMore={reading.nextPageToken !== null}
        trash={trash}
      />
    </>
  );
}
