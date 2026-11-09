import { FolderCog, HardDrive, Users } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router";

import { Button, buttonVariants } from "@/app/components/ui/button";
import {
  STORAGE_MY_DRIVE_ID,
  STORAGE_SHARED_DRIVES_ID,
} from "@/definition/GoogleDriveStorage";

import { StorageActionDialogs } from "./storage-action-dialogs";
import {
  StorageActionError,
  StorageReadOnlyNotice,
  StorageSimulationBanner,
} from "./storage-action-notices";
import { StorageActionToolbar } from "./storage-action-toolbar";
import { StorageContent } from "./storage-content";
import { pathText, storageFolderHref } from "./storage-format";
import { StorageHeader } from "./storage-header";
import { StorageReachNotice, StorageRenamedNotice } from "./storage-notices";
import { requestStartFolderChange } from "./storage-requests";
import { StorageStartFolderPicker } from "./storage-start-folder-picker";
import { StorageTrashPanel } from "./storage-trash-panel";
import { useStorageFolder } from "./use-storage-folder";
import { useStorageFileManager } from "./use-storage-file-manager";
import { useStorageFolderActions } from "./use-storage-folder-actions";

import type { StorageCapabilities } from "@/definition/GoogleDriveFiles";
import type {
  StorageBrowseResult,
  StorageStartFolder,
} from "@/definition/GoogleDriveStorage";

import type { StorageFolderActions } from "./use-storage-folder-actions";

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

/** Whether Drive is simulated, by the folder answer or by the capabilities. */
function isSimulated(
  result: StorageBrowseResult,
  capabilities: StorageCapabilities | null,
): boolean {
  return result.isSimulation === true || capabilities?.isSimulation === true;
}

function StorageMessages({
  result,
  capabilities,
}: {
  readonly result: StorageBrowseResult;
  readonly capabilities: StorageCapabilities | null;
}): React.ReactElement | null {
  const renamedTo = result.startFolder?.name ?? null;
  const isSimulation = isSimulated(result, capabilities);
  const isReadOnly = capabilities !== null && !capabilities.canWrite;
  const hasRenamed =
    result.startFolderRenamedFrom !== null && renamedTo !== null;
  const hasMessages =
    result.reach === "app_files" || hasRenamed || isSimulation || isReadOnly;

  if (!hasMessages) {
    return null;
  }

  return (
    <div className="flex flex-col gap-2">
      {isSimulation ? <StorageSimulationBanner /> : null}
      {isReadOnly ? (
        <StorageReadOnlyNotice capabilities={capabilities} />
      ) : null}
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

/** The folder actions, a failure no dialog resolves, and the trash switch. */
function StorageActionBar({
  writing,
  isTrashOpen,
  onToggleTrash,
}: {
  readonly writing: StorageFolderActions;
  readonly isTrashOpen: boolean;
  readonly onToggleTrash: () => void;
}): React.ReactElement {
  const { actions } = writing;

  return (
    <>
      <StorageActionToolbar
        actions={actions}
        canAddHere={writing.canAddHere}
        isTrashOpen={isTrashOpen}
        onToggleTrash={onToggleTrash}
      />
      {actions.dialog.kind === "none" && actions.error !== null ? (
        <StorageActionError
          error={actions.error}
          onDismiss={actions.dismissError}
        />
      ) : null}
    </>
  );
}

/**
 * The frame of the Storage area.
 *
 * The section fills the width beside the global navigation and the height
 * down to the bottom padding of the frame (`2.5rem`); only the list inside the
 * card scrolls, menu bar, column heads and footer stay. Its own bottom
 * padding keeps the card just above the Pica launcher (PAGE-272), so the
 * launcher never covers it, also while the list scrolls or the window
 * changes: on tablets and desktops the launcher takes `1rem` offset and a
 * `3.5rem` button, and the card ends `0.75rem` above it (`5.25rem` above the
 * viewport bottom); on phones, where the launcher sits `4rem` up, it ends
 * `8.25rem` above the bottom. The safe-area inset the launcher adds is added
 * here as well.
 *
 * The bottom padding sits outside the inner column, which scrolls when the
 * notices above the card need more room than a phone has: nothing scrolls
 * through the free space of the launcher, so it covers no part of the card
 * at any scroll position.
 */
function StorageFrame({
  children,
}: {
  readonly children: React.ReactNode;
}): React.ReactElement {
  return (
    <section className="flex h-[calc(100dvh-8.5rem)] min-h-0 flex-col pb-[calc(env(safe-area-inset-bottom)+5.75rem)] md:pb-[calc(env(safe-area-inset-bottom)+2.75rem)]">
      <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-1">
        {children}
      </div>
    </section>
  );
}

/**
 * The Storage area (PAGE-188): the Google Drive of the existing instance
 * connection, with path, file list, start folder and storage quota.
 */
export function StoragePage(): React.ReactElement {
  const [searchParams] = useSearchParams();
  const folderId = readFolderParameter(searchParams);
  const model = useStorageFolder({ folderId, isFoldersOnly: false });
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [isTrashOpen, setIsTrashOpen] = useState(false);
  const result = model.reading.kind === "loaded" ? model.reading.result : null;
  const writing = useStorageFolderActions(result, model.reload);
  const manager = useStorageFileManager(result, writing, model.reload);

  function toggleTrash(): void {
    // A restore in the trash may bring entries back into the shown folder.
    if (isTrashOpen) model.reload();

    setIsTrashOpen(!isTrashOpen);
  }

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
    <StorageFrame>
      <StorageHeader
        isConnected={result !== null}
        path={result?.folder?.path ?? []}
      />
      {result ? (
        <StorageMessages capabilities={writing.capabilities} result={result} />
      ) : null}
      {result ? (
        <StorageToolbar
          isExplicitTarget={folderId !== null}
          onChoose={() => setIsPickerOpen(true)}
          result={result}
        />
      ) : null}
      {result ? (
        <StorageActionBar
          isTrashOpen={isTrashOpen}
          onToggleTrash={toggleTrash}
          writing={writing}
        />
      ) : null}
      {isTrashOpen ? null : manager.notices}
      {isTrashOpen ? (
        <StorageTrashPanel canWrite={writing.canWrite} />
      ) : (
        <StorageContent
          model={model}
          onChooseStartFolder={() => setIsPickerOpen(true)}
          onClearStartFolder={() => void clearStartFolder()}
          renderActions={writing.renderActions}
          tools={manager.tools}
        />
      )}
      <StorageActionDialogs actions={writing.actions} />
      {manager.overlays}
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
    </StorageFrame>
  );
}
