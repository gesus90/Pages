import { useState } from "react";

import { requestStorageBatch } from "./storage-actions-requests";

import type {
  StorageBatchAction,
  StorageErrorCode,
  StorageError,
} from "@/definition/GoogleDriveFiles";
import type { StorageItem } from "@/definition/GoogleDriveStorage";

/** One entry remembered for a later paste, or named in an outcome. */
export interface StorageBatchEntry {
  readonly ref: string;
  readonly name: string;
  readonly isFolder: boolean;
}

/** What waits to be pasted: copied or moved entries of one folder. */
export interface StorageClipboard {
  readonly mode: "copy" | "move";
  /** The folder the entries were taken from. */
  readonly sourceRef: string;
  readonly entries: readonly StorageBatchEntry[];
}

/** The outcome of the last batch action, shown until it is dismissed. */
export interface StorageBatchOutcome {
  readonly action: StorageBatchAction;
  readonly succeeded: number;
  readonly failures: readonly {
    readonly entry: StorageBatchEntry;
    readonly code: StorageErrorCode;
  }[];
}

/** Copy, move, paste and trash for the selection of the shown folder. */
export interface StorageBatchModel {
  readonly clipboard: StorageClipboard | null;
  readonly isBusy: boolean;
  readonly outcome: StorageBatchOutcome | null;
  /** A failure of the whole call, such as a missing write access. */
  readonly error: StorageError | null;
  /** The entries a confirmation asks to move to the trash, else `null`. */
  readonly pendingTrash: readonly StorageBatchEntry[] | null;
  readonly remember: (
    mode: StorageClipboard["mode"],
    items: readonly StorageItem[],
  ) => void;
  readonly paste: () => void;
  readonly askTrash: (items: readonly StorageItem[]) => void;
  readonly confirmTrash: () => void;
  readonly cancelTrash: () => void;
  readonly dismiss: () => void;
}

/** Where the batch actions work and what happens after them. */
export interface StorageBatchOptions {
  /** The shown folder when it is a real folder, else `null`. */
  readonly folderRef: string | null;
  /** Reloads the shown folder after every batch call. */
  readonly onChanged: () => void;
  /** Empties the selection after its entries moved away. */
  readonly onSelectionGone: () => void;
}

function entriesOf(items: readonly StorageItem[]): StorageBatchEntry[] {
  return items.map((item) => ({
    isFolder: item.isFolder,
    name: item.name,
    ref: item.id,
  }));
}

/**
 * Runs the actions of the Storage menu bar that change several entries at
 * once (PAGE-272) through the `batch` operation of the Storage interface.
 *
 * @param options - The shown folder, the reload and the selection reset.
 * @returns The clipboard, the outcome and the actions.
 *
 * @remarks
 * Copy and move only remember the entries with their folder, so the
 * clipboard survives a change of folder; paste runs them in the shown
 * folder. A moved selection is pasted once, a copied one as often as wanted.
 * After every call the folder reloads, also when entries were refused.
 */
export function useStorageBatch(
  options: StorageBatchOptions,
): StorageBatchModel {
  const { folderRef, onChanged, onSelectionGone } = options;
  const [clipboard, setClipboard] = useState<StorageClipboard | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [outcome, setOutcome] = useState<StorageBatchOutcome | null>(null);
  const [error, setError] = useState<StorageError | null>(null);
  const [pendingTrash, setPendingTrash] = useState<
    readonly StorageBatchEntry[] | null
  >(null);

  async function run(input: {
    readonly action: StorageBatchAction;
    readonly sourceRef: string;
    readonly entries: readonly StorageBatchEntry[];
    readonly targetParentRef: string | null;
  }): Promise<boolean> {
    setIsBusy(true);
    setError(null);
    setOutcome(null);
    const reply = await requestStorageBatch({
      action: input.action,
      refs: input.entries.map((entry) => entry.ref),
      sourceRef: input.sourceRef,
      targetParentRef: input.targetParentRef,
    });
    setIsBusy(false);
    onChanged();

    if (!reply.ok) {
      setError(reply.error);
      return false;
    }

    const byRef = new Map(input.entries.map((entry) => [entry.ref, entry]));

    setOutcome({
      action: reply.value.action,
      failures: reply.value.failures.map((failure) => ({
        code: failure.code,
        entry: byRef.get(failure.ref) ?? {
          isFolder: false,
          name: failure.ref,
          ref: failure.ref,
        },
      })),
      succeeded: reply.value.succeeded,
    });

    return true;
  }

  async function paste(): Promise<void> {
    if (clipboard === null || folderRef === null) return;

    const isDone = await run({
      action: clipboard.mode,
      entries: clipboard.entries,
      sourceRef: clipboard.sourceRef,
      targetParentRef: folderRef,
    });

    if (isDone && clipboard.mode === "move") setClipboard(null);
  }

  async function confirmTrash(): Promise<void> {
    if (pendingTrash === null || folderRef === null) return;

    const entries = pendingTrash;

    setPendingTrash(null);
    await run({
      action: "delete",
      entries,
      sourceRef: folderRef,
      targetParentRef: null,
    });
    onSelectionGone();
  }

  return {
    askTrash: (items) => setPendingTrash(entriesOf(items)),
    cancelTrash: () => setPendingTrash(null),
    clipboard,
    confirmTrash: () => void confirmTrash(),
    dismiss: () => {
      setOutcome(null);
      setError(null);
    },
    error,
    isBusy,
    outcome,
    paste: () => void paste(),
    pendingTrash,
    remember: (mode, items) => {
      if (folderRef === null || items.length === 0) return;

      setOutcome(null);
      setClipboard({ entries: entriesOf(items), mode, sourceRef: folderRef });
    },
  };
}
