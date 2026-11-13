import { useState } from "react";

import { STORAGE_SHARED_DRIVES_ID } from "@/definition/GoogleDriveStorage";

import {
  StorageBatchNotices,
  StorageTrashDialog,
} from "./storage-batch-notices";
import { buildStorageCommands } from "./storage-commands";
import { StorageContextMenu } from "./storage-context-menu";
import { StorageMenuBar } from "./storage-menu-bar";
import { useStorageBatch } from "./use-storage-batch";
import { useStorageSelection } from "./use-storage-selection";

import type { StorageBrowseResult } from "@/definition/GoogleDriveStorage";
import type { ReactNode } from "react";
import type { StorageListTools } from "./storage-content";
import type { StorageMenuPoint } from "./storage-context-menu";
import type { StorageFolderActions } from "./use-storage-folder-actions";

/** The file management of the shown folder, ready to be placed. */
export interface StorageFileManager {
  /** Menu bar, selection and context menu of the list; absent without a folder. */
  readonly tools: StorageListTools | undefined;
  /** The outcome of the last batch action. */
  readonly notices: ReactNode;
  /** The context menu and the trash confirmation. */
  readonly overlays: ReactNode;
}

/**
 * Connects the shown folder with selection, clipboard, menu bar and context
 * menu (PAGE-272).
 *
 * @param result - The loaded folder, or `null` before it is shown.
 * @param writing - The single actions and the write right of the folder.
 * @param onChanged - Reloads the folder.
 * @returns What the page places around and above the list.
 */
export function useStorageFileManager(
  result: StorageBrowseResult | null,
  writing: StorageFolderActions,
  onChanged: () => void,
): StorageFileManager {
  const folder = result?.folder ?? null;
  const items = folder?.items ?? [];
  const folderRef =
    folder === null || folder.folderId === STORAGE_SHARED_DRIVES_ID
      ? null
      : folder.folderId;
  const selection = useStorageSelection(items, folder?.folderId ?? null);
  const batch = useStorageBatch({
    folderRef,
    onChanged,
    onSelectionGone: selection.clear,
  });
  const [menuPoint, setMenuPoint] = useState<StorageMenuPoint | null>(null);
  const commands = buildStorageCommands({
    actions: writing.actions,
    batch,
    canWrite: writing.canWrite,
    operations: writing.capabilities?.operations,
    folderRef,
    items,
    selection,
  });

  return {
    notices: <StorageBatchNotices batch={batch} />,
    overlays: (
      <>
        <StorageContextMenu
          commands={commands}
          onClose={() => setMenuPoint(null)}
          point={menuPoint}
        />
        <StorageTrashDialog batch={batch} />
      </>
    ),
    tools:
      folder === null
        ? undefined
        : {
            menuBar: (
              <StorageMenuBar
                clipboard={batch.clipboard}
                commands={commands}
                selectedCount={selection.items.length}
              />
            ),
            onOpenMenu: setMenuPoint,
            selection,
          },
  };
}
