import {
  ClipboardPaste,
  Copy,
  FolderPlus,
  ListChecks,
  Pencil,
  Scissors,
  SquareCheckBig,
  Trash2,
} from "lucide-react";

import { STORAGE_BATCH_LIMIT } from "@/definition/GoogleDriveFiles";

import type { StorageItem } from "@/definition/GoogleDriveStorage";
import type { LucideIcon } from "lucide-react";

import type { StorageActionsModel } from "./use-storage-actions";
import type { StorageBatchModel } from "./use-storage-batch";
import type { StorageSelection } from "./use-storage-selection";

/** The actions of the menu bar and the context menu, in their order. */
export type StorageCommandId =
  | "newFolder"
  | "rename"
  | "copy"
  | "move"
  | "paste"
  | "trash"
  | "multiSelect"
  | "selectAll";

/** One action as the menu bar and the context menu show it. */
export interface StorageCommand {
  readonly id: StorageCommandId;
  readonly icon: LucideIcon;
  readonly isDisabled: boolean;
  /** Translation key of why the action is not available, when it helps. */
  readonly hintKey: string | null;
  readonly isDestructive: boolean;
  /** Set for the switch of the multi-select mode. */
  readonly isPressed: boolean | null;
  readonly run: () => void;
  /** Starts a new group after this action. */
  readonly endsGroup: boolean;
}

/** What the actions depend on. */
export interface StorageCommandsInput {
  /** The shown folder when it is a real folder, else `null`. */
  readonly folderRef: string | null;
  readonly items: readonly StorageItem[];
  readonly canWrite: boolean;
  readonly actions: StorageActionsModel;
  readonly batch: StorageBatchModel;
  readonly selection: StorageSelection;
}

function selectionHint(
  count: number,
  hasFolder: boolean,
  isCopy: boolean,
): string | null {
  if (count > STORAGE_BATCH_LIMIT) return "storage.menu.hint.limit";
  if (isCopy && hasFolder) return "storage.menu.hint.copyFolder";

  return null;
}

function pasteBlocked(input: StorageCommandsInput): boolean {
  const { batch, folderRef } = input;
  const clipboard = batch.clipboard;

  if (clipboard === null || folderRef === null) return true;
  if (clipboard.mode === "copy") return false;

  // Moving into the same folder changes nothing; into itself Drive refuses.
  return (
    clipboard.sourceRef === folderRef ||
    clipboard.entries.some((entry) => entry.ref === folderRef)
  );
}

/**
 * Builds the actions of the Storage menu bar and context menu (PAGE-272):
 * new folder, rename, copy, move, paste, trash, multi-select and select all.
 *
 * @param input - Folder, entries, write right, actions and selection.
 * @returns The actions with whether each is available right now.
 *
 * @remarks
 * Both menus show exactly this list, so they always offer the same actions.
 * Without the write access only the selection actions stay available.
 */
export function buildStorageCommands(
  input: StorageCommandsInput,
): readonly StorageCommand[] {
  const { actions, batch, canWrite, folderRef, items, selection } = input;
  const selected = selection.items;
  const count = selected.length;
  const hasFolder = selected.some((item) => item.isFolder);
  const canChange =
    canWrite && folderRef !== null && !actions.isBusy && !batch.isBusy;
  const isSelectionUsable = count > 0 && count <= STORAGE_BATCH_LIMIT;
  const first = selected[0];
  const base = { endsGroup: false, isDestructive: false, isPressed: null };

  return [
    {
      ...base,
      hintKey: null,
      icon: FolderPlus,
      id: "newFolder",
      isDisabled: !canChange,
      run: () => actions.openNameDialog("create_folder", null),
    },
    {
      ...base,
      hintKey: null,
      icon: Pencil,
      id: "rename",
      isDisabled: !canChange || count !== 1,
      run: () => {
        if (first)
          actions.openNameDialog("rename", {
            isFolder: first.isFolder,
            name: first.name,
            ref: first.id,
          });
      },
    },
    {
      ...base,
      hintKey: selectionHint(count, hasFolder, true),
      icon: Copy,
      id: "copy",
      isDisabled: !canChange || !isSelectionUsable || hasFolder,
      run: () => batch.remember("copy", selected),
    },
    {
      ...base,
      hintKey: selectionHint(count, hasFolder, false),
      icon: Scissors,
      id: "move",
      isDisabled: !canChange || !isSelectionUsable,
      run: () => batch.remember("move", selected),
    },
    {
      ...base,
      hintKey: null,
      icon: ClipboardPaste,
      id: "paste",
      isDisabled: !canChange || pasteBlocked(input),
      run: batch.paste,
    },
    {
      ...base,
      endsGroup: true,
      hintKey: selectionHint(count, hasFolder, false),
      icon: Trash2,
      id: "trash",
      isDestructive: true,
      isDisabled: !canChange || !isSelectionUsable,
      run: () => batch.askTrash(selected),
    },
    {
      ...base,
      hintKey: null,
      icon: ListChecks,
      id: "multiSelect",
      isDisabled: folderRef === null,
      isPressed: selection.isMultiSelect,
      run: selection.toggleMultiSelect,
    },
    {
      ...base,
      hintKey: null,
      icon: SquareCheckBig,
      id: "selectAll",
      isDisabled: folderRef === null || items.length === 0,
      run: selection.selectAll,
    },
  ];
}
