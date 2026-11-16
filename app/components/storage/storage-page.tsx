import { FolderCog, HardDrive, Users } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useSearchParams } from "react-router";

import { useCompactScreen } from "@/app/components/chat-page/chat-menu/use-compact-screen";
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
import { pendingFolderPath } from "./storage-folder-link";
import { pathText, storageFolderHref } from "./storage-format";
import { StorageHeader } from "./storage-header";
import { StorageReachNotice, StorageRenamedNotice } from "./storage-notices";
import { StoragePreview } from "./storage-preview";
import {
  useRestoreListFocus,
  useStoragePreviewRoute,
} from "./storage-preview-route";
import { requestStartFolderChange } from "./storage-requests";
import { StorageStartFolderPicker } from "./storage-start-folder-picker";
import { StorageTrashPanel } from "./storage-trash-panel";
import { useKeepListScroll } from "./use-keep-list-scroll";
import { useStorageFolder } from "./use-storage-folder";
import { useStorageFileManager } from "./use-storage-file-manager";
import { useStorageFolderActions } from "./use-storage-folder-actions";
import { useStoragePreview } from "./storage-preview/use-storage-preview";

import type { StorageCapabilities } from "@/definition/GoogleDriveFiles";
import type {
  StorageBrowseResult,
  StorageItem,
  StoragePathEntry,
  StorageStartFolder,
} from "@/definition/GoogleDriveStorage";
import type { StorageFolderModel } from "./use-storage-folder";
import type { StorageFileManager } from "./use-storage-file-manager";
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
          {t(result.isScoped ? "storage.access.roots" : "storage.myDrive")}
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
      {result.isScoped ? null : (
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
      )}
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
  isSwitching,
  isTrashOpen,
  onToggleTrash,
}: {
  readonly writing: StorageFolderActions;
  /** Whether the shown folder is being replaced; nothing is added to it then. */
  readonly isSwitching: boolean;
  readonly isTrashOpen: boolean;
  readonly onToggleTrash: () => void;
}): React.ReactElement {
  const { actions } = writing;

  return (
    <>
      <StorageActionToolbar
        canUseTrash={
          writing.capabilities !== null &&
          writing.capabilities.grantedFolders === undefined
        }
        actions={actions}
        canAddHere={writing.canAddHere && !isSwitching}
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
 * The section fills the width beside the global navigation and the height
 * down to the bottom padding of the frame (`2.5rem`); only the list inside the
 * card scrolls, menu bar, column heads and footer stay. Its own bottom
 * padding keeps the card just above the Pica launcher, so the
 * launcher never covers it, also while the list scrolls or the window
 * changes: on tablets and desktops the launcher takes `1rem` offset and a
 * `3.5rem` button, and the card ends `0.75rem` above it (`5.25rem` above the
 * viewport bottom); on phones, where the launcher sits `4rem` up, it ends
 * `8.25rem` above the bottom. The safe-area inset the launcher adds is added
 * here as well.
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

function StorageLoadedControls(props: {
  readonly result: StorageBrowseResult | null;
  readonly folderId: string | null;
  readonly isSwitching: boolean;
  readonly isTrashOpen: boolean;
  readonly writing: ReturnType<typeof useStorageFolderActions>;
  readonly onChoose: () => void;
  readonly onToggleTrash: () => void;
}): React.ReactElement | null {
  const { result } = props;
  if (!result) return null;
  return (
    <>
      <StorageMessages
        capabilities={props.writing.capabilities}
        result={result}
      />
      <StorageToolbar
        isExplicitTarget={props.folderId !== null}
        onChoose={props.onChoose}
        result={result}
      />
      <StorageActionBar
        isSwitching={props.isSwitching}
        isTrashOpen={props.isTrashOpen}
        onToggleTrash={props.onToggleTrash}
        writing={props.writing}
      />
    </>
  );
}

/** The dialogs, the menus above the list and the start folder picker. */
function StorageLayers(props: {
  readonly result: StorageBrowseResult | null;
  readonly writing: StorageFolderActions;
  readonly manager: StorageFileManager;
  readonly isPickerOpen: boolean;
  readonly onPickerOpenChange: (isOpen: boolean) => void;
  readonly onSaved: (startFolder: StorageStartFolder | null) => void;
}): React.ReactElement {
  const { result } = props;

  return (
    <>
      <StorageActionDialogs actions={props.writing.actions} />
      {props.manager.overlays}
      {result && !result.isScoped ? (
        <StorageStartFolderPicker
          initialFolderId={
            result.folder?.canBeStartFolder
              ? result.folder.folderId
              : STORAGE_MY_DRIVE_ID
          }
          isOpen={props.isPickerOpen}
          onOpenChange={props.onPickerOpenChange}
          onSaved={props.onSaved}
          startFolder={result.startFolder}
        />
      ) : null}
    </>
  );
}

/** What the page shows of the folder: the loaded one, or the former one while another loads. */
interface ShownFolder {
  readonly result: StorageBrowseResult | null;
  /** The path of the asked folder; before Drive answers it follows the click. */
  readonly path: readonly StoragePathEntry[];
  /** The folder that is being opened; its row shows the progress. */
  readonly openingFolderId: string | null;
}

function useShownFolder(
  model: StorageFolderModel,
  folderId: string | null,
): ShownFolder {
  const location = useLocation();
  const { reading } = model;

  if (reading.kind === "loaded") {
    return {
      openingFolderId: null,
      path: reading.result.folder?.path ?? [],
      result: reading.result,
    };
  }

  const result = model.previousResult;

  return {
    openingFolderId: reading.kind === "loading" ? folderId : null,
    path: pendingFolderPath({
      folderId,
      previous: result?.folder ?? null,
      state: location.state,
    }),
    result,
  };
}

/** The preview a `file` parameter asks for: its state, name and the way out. */
function useStoragePagePreview(result: StorageBrowseResult | null): {
  readonly route: ReturnType<typeof useStoragePreviewRoute>;
  readonly model: ReturnType<typeof useStoragePreview>;
  readonly listed: StorageItem | null;
  readonly fileName: string | null;
} {
  const route = useStoragePreviewRoute();
  const model = useStoragePreview(route.fileRef);
  const listed =
    result?.folder?.items.find((item) => item.id === route.fileRef) ?? null;
  const name = model.outcome?.entry?.name ?? listed?.name ?? "";

  useRestoreListFocus(route.fileRef);

  return {
    fileName: name === "" ? null : name,
    listed,
    model,
    route,
  };
}

/**
 * The Storage area: the Google Drive of the existing instance
 * connection, with path, file list, start folder and storage quota.
 * @remarks
 * A file name opens a read-only preview in place of the list card, addressed
 * by `?file=`. The list, its selection and its scroll position stay in
 * place behind it, so closing returns to exactly where the person was.
 */
export function StoragePage(): React.ReactElement {
  const [searchParams] = useSearchParams();
  const folderId = readFolderParameter(searchParams);
  const model = useStorageFolder({ folderId, isFoldersOnly: false });
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [isTrashOpen, setIsTrashOpen] = useState(false);
  // While another folder loads, the former one keeps header, toolbar and card
  // in place, and the path already names the asked folder.
  const { result, path, openingFolderId } = useShownFolder(model, folderId);
  const writing = useStorageFolderActions(result, model.reload);
  const manager = useStorageFileManager(result, writing, model.reload);
  const preview = useStoragePagePreview(result);
  const { route } = preview;
  const isPreviewing = route.fileRef !== null;
  const isPhone = useCompactScreen();
  const handleListScroll = useKeepListScroll(isPreviewing);

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
      {/* Behind a full-screen preview nothing of the page can be reached. */}
      <div className="contents" inert={isPreviewing && isPhone}>
        <StorageHeader
          fileName={preview.fileName}
          isConnected={result !== null}
          path={path}
        />
      </div>
      {/* The list stays mounted behind the preview, so its selection, scroll
          position and folder survive; it is only not shown. */}
      <div
        className={isPreviewing ? "hidden" : "contents"}
        onScrollCapture={handleListScroll}
      >
        <StorageLoadedControls
          result={result}
          folderId={folderId}
          isSwitching={model.previousResult !== null}
          isTrashOpen={isTrashOpen}
          writing={writing}
          onChoose={() => setIsPickerOpen(true)}
          onToggleTrash={toggleTrash}
        />
        {isTrashOpen ? null : manager.notices}
        {isTrashOpen ? (
          <StorageTrashPanel canWrite={writing.canWrite} />
        ) : (
          <StorageContent
            model={model}
            openingFolderId={openingFolderId}
            onChooseStartFolder={() => setIsPickerOpen(true)}
            onClearStartFolder={() => void clearStartFolder()}
            renderActions={writing.renderActions}
            tools={manager.tools}
          />
        )}
      </div>
      {route.fileRef === null ? null : (
        <StoragePreview
          fileRef={route.fileRef}
          key={route.fileRef}
          listed={preview.listed}
          model={preview.model}
          onClose={route.close}
        />
      )}
      <StorageLayers
        isPickerOpen={isPickerOpen}
        manager={manager}
        onPickerOpenChange={setIsPickerOpen}
        onSaved={handleSaved}
        result={result}
        writing={writing}
      />
    </StorageFrame>
  );
}
