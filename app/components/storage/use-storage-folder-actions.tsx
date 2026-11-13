import { STORAGE_SHARED_DRIVES_ID } from "@/definition/GoogleDriveStorage";

import { StorageFileActions } from "./storage-file-actions";
import { useStorageActions } from "./use-storage-actions";
import { useStorageCapabilities } from "./use-storage-capabilities";

import type { StorageCapabilities } from "@/definition/GoogleDriveFiles";
import type {
  StorageBrowseResult,
  StorageItem,
} from "@/definition/GoogleDriveStorage";
import type { ReactNode } from "react";
import type { StorageActionsModel } from "./use-storage-actions";

/** The changing side of the shown folder. */
export interface StorageFolderActions {
  /** `null` while the capabilities load or when they are unknown. */
  readonly capabilities: StorageCapabilities | null;
  readonly canWrite: boolean;
  /** Whether the shown folder takes new folders and uploads. */
  readonly canAddHere: boolean;
  readonly actions: StorageActionsModel;
  /** The menu of one entry; absent where entries have none, such as the shared-drive list. */
  readonly renderActions?: (item: StorageItem) => ReactNode;
}

/** The shown folder when it is a real folder; the shared-drive list is none. */
function realFolderRef(result: StorageBrowseResult | null): string | null {
  const folder = result?.folder ?? null;

  if (folder === null || folder.folderId === STORAGE_SHARED_DRIVES_ID) {
    return null;
  }

  return folder.folderId;
}

function exportFormatsOf(
  capabilities: StorageCapabilities | null,
  mimeType: string,
): readonly string[] {
  if (
    capabilities === null ||
    !Object.hasOwn(capabilities.exportFormats, mimeType)
  ) {
    return [];
  }

  return capabilities.exportFormats[mimeType] ?? [];
}

/**
 * Connects the shown folder with the Storage actions (PAGE-270): the
 * capabilities decide whether anything can change, and every successful
 * change reloads the folder.
 *
 * @param result - The loaded folder, or `null` before it is shown.
 * @param onChanged - Reloads the folder.
 * @returns The actions of the toolbar, the rows and the dialogs.
 */
export function useStorageFolderActions(
  result: StorageBrowseResult | null,
  onChanged: () => void,
): StorageFolderActions {
  const folderRef = realFolderRef(result);
  const capabilities = useStorageCapabilities(folderRef);
  const canWrite = capabilities?.canWrite === true;
  const actions = useStorageActions({
    maxUploadBytes: capabilities?.maxUploadBytes ?? null,
    onChanged,
    parentRef: folderRef,
  });

  function renderActions(item: StorageItem): ReactNode {
    return (
      <StorageFileActions
        actions={actions}
        target={{
          exportFormats: exportFormatsOf(capabilities, item.mimeType),
          isFolder: item.isFolder,
          mimeType: item.mimeType,
          name: item.name,
          ref: item.id,
        }}
      />
    );
  }

  return {
    actions,
    canAddHere: canWrite && folderRef !== null,
    canWrite,
    capabilities,
    renderActions: folderRef === null ? undefined : renderActions,
  };
}
