import { FolderCog, HardDrive, Users } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router";

import { Button, buttonVariants } from "@/app/components/ui/button";
import {
  STORAGE_MY_DRIVE_ID,
  STORAGE_SHARED_DRIVES_ID,
} from "@/definition/GoogleDriveStorage";

import { StorageContent } from "./storage-content";
import { pathText, storageFolderHref } from "./storage-format";
import { StorageHeader } from "./storage-header";
import { StorageReachNotice, StorageRenamedNotice } from "./storage-notices";
import { requestStartFolderChange } from "./storage-requests";
import { StorageStartFolderPicker } from "./storage-start-folder-picker";
import { useStorageFolder } from "./use-storage-folder";

import type {
  StorageBrowseResult,
  StorageStartFolder,
} from "@/definition/GoogleDriveStorage";

/** The folder of the address; without one the start folder opens. */
function readFolderParameter(searchParams: URLSearchParams): string | null {
  const folderId = searchParams.get("folder")?.trim() ?? "";

  return folderId === "" ? null : folderId;
}

function StorageToolbar({
  result,
  isExplicitTarget,
  onChoose,
}: {
  readonly result: StorageBrowseResult;
  readonly isExplicitTarget: boolean;
  readonly onChoose: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const linkClass = buttonVariants({ size: "xs", variant: "ghost" });

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap items-center gap-1">
        <Link className={linkClass} to={storageFolderHref(STORAGE_MY_DRIVE_ID)}>
          <HardDrive aria-hidden="true" className="size-3.5" />
          {t("storage.myDrive")}
        </Link>
        {result.hasSharedDrives ? (
          <Link
            className={linkClass}
            to={storageFolderHref(STORAGE_SHARED_DRIVES_ID)}
          >
            <Users aria-hidden="true" className="size-3.5" />
            {t("storage.sharedDrives")}
          </Link>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="min-w-0 truncate">
          {result.startFolder
            ? t("storage.startFolder.label", {
                path: pathText(result.startFolder.path, t),
              })
            : t("storage.startFolder.none")}
        </span>
        {result.startFolder && isExplicitTarget ? (
          <Link className={linkClass} to={storageFolderHref(null)}>
            {t("storage.openStart")}
          </Link>
        ) : null}
        <Button onClick={onChoose} size="xs" type="button" variant="outline">
          <FolderCog aria-hidden="true" className="size-3.5" />
          {t("storage.startFolder.choose")}
        </Button>
      </div>
    </div>
  );
}

function StorageMessages({
  result,
}: {
  readonly result: StorageBrowseResult;
}): React.ReactElement | null {
  const renamedTo = result.startFolder?.name ?? null;

  if (
    result.reach === "full" &&
    (result.startFolderRenamedFrom === null || renamedTo === null)
  ) {
    return null;
  }

  return (
    <div className="flex flex-col gap-2">
      {result.reach === "app_files" ? <StorageReachNotice /> : null}
      {result.startFolderRenamedFrom !== null && renamedTo !== null ? (
        <StorageRenamedNotice
          from={result.startFolderRenamedFrom}
          to={renamedTo}
        />
      ) : null}
    </div>
  );
}

/**
 * The Storage area (PAGE-188): the Google Drive of the existing instance
 * connection, with path, file list, start folder and storage quota.
 *
 * @remarks
 * The section fills the width beside the global navigation and the height
 * down to the bottom padding of the frame (`2.5rem`); only the list inside the
 * card scrolls. Its own bottom padding keeps the free space of the Pica
 * launcher, so the launcher never covers the card, also while the list
 * scrolls or the window changes: on tablets and desktops the card ends
 * `9.75rem` above the viewport bottom, which is the launcher (`1rem` offset,
 * `3.5rem` button) plus a gap of about 85 px; on phones, where the launcher
 * sits `4rem` up, it ends `8.5rem` above the bottom.
 */
export function StoragePage(): React.ReactElement {
  const [searchParams] = useSearchParams();
  const folderId = readFolderParameter(searchParams);
  const model = useStorageFolder({ folderId, isFoldersOnly: false });
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const result = model.reading.kind === "loaded" ? model.reading.result : null;

  function handleSaved(startFolder: StorageStartFolder | null): void {
    setIsPickerOpen(false);

    if (result?.folder) {
      model.replaceStartFolder(startFolder);
      return;
    }

    model.reload();
  }

  async function clearStartFolder(): Promise<void> {
    await requestStartFolderChange(null);
    model.reload();
  }

  return (
    <section className="flex h-[calc(100dvh-8.5rem)] min-h-0 flex-col gap-4 pb-24 md:pb-29">
      <StorageHeader
        isConnected={result !== null}
        path={result?.folder?.path ?? []}
      />
      {result ? <StorageMessages result={result} /> : null}
      {result ? (
        <StorageToolbar
          isExplicitTarget={folderId !== null}
          onChoose={() => setIsPickerOpen(true)}
          result={result}
        />
      ) : null}
      <StorageContent
        model={model}
        onChooseStartFolder={() => setIsPickerOpen(true)}
        onClearStartFolder={() => void clearStartFolder()}
      />
      {result ? (
        <StorageStartFolderPicker
          initialFolderId={
            result.folder?.canBeStartFolder
              ? result.folder.folderId
              : STORAGE_MY_DRIVE_ID
          }
          isOpen={isPickerOpen}
          onOpenChange={setIsPickerOpen}
          onSaved={handleSaved}
          startFolder={result.startFolder}
        />
      ) : null}
    </section>
  );
}
