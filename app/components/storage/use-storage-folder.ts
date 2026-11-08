import { useEffect, useState } from "react";

import { requestStorageFolder } from "./storage-requests";

import type {
  StorageBrowseResult,
  StorageConnectionUnavailable,
  StorageStartFolder,
} from "@/definition/GoogleDriveStorage";

import type { StorageRequestFailure } from "./storage-requests";

/** What the view knows about the asked folder. */
export type StorageFolderReading =
  | { readonly kind: "loading" }
  | { readonly kind: "failed"; readonly failure: StorageRequestFailure }
  | {
      readonly kind: "connection";
      readonly connection: StorageConnectionUnavailable;
    }
  | { readonly kind: "loaded"; readonly result: StorageBrowseResult };

/** The folder of the view and what can be done with it. */
export interface StorageFolderModel {
  readonly reading: StorageFolderReading;
  readonly isLoadingMore: boolean;
  readonly loadMoreFailed: boolean;
  readonly loadMore: () => void;
  readonly reload: () => void;
  /** Shows a saved or cleared start folder without asking Drive again. */
  readonly replaceStartFolder: (startFolder: StorageStartFolder | null) => void;
}

/** What one load asks for. */
interface StorageFolderTarget {
  readonly folderId: string | null;
  readonly isFoldersOnly: boolean;
}

function toReading(
  reply: Awaited<ReturnType<typeof requestStorageFolder>>,
): StorageFolderReading {
  if (!reply.ok) {
    return { failure: reply.failure, kind: "failed" };
  }

  return reply.value.kind === "connection"
    ? { connection: reply.value, kind: "connection" }
    : { kind: "loaded", result: reply.value };
}

/** Appends the next page to a loaded folder. */
function appendPage(
  reading: StorageFolderReading,
  next: StorageBrowseResult,
): StorageFolderReading {
  if (reading.kind !== "loaded" || !reading.result.folder || !next.folder) {
    return reading;
  }

  return {
    kind: "loaded",
    result: {
      ...reading.result,
      folder: {
        ...reading.result.folder,
        items: [...reading.result.folder.items, ...next.folder.items],
        nextPageToken: next.folder.nextPageToken,
      },
    },
  };
}

function useMorePages(
  reading: StorageFolderReading,
  target: StorageFolderTarget,
  setReading: (
    update: (current: StorageFolderReading) => StorageFolderReading,
  ) => void,
): Pick<StorageFolderModel, "isLoadingMore" | "loadMore" | "loadMoreFailed"> {
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);
  const folder = reading.kind === "loaded" ? reading.result.folder : null;

  async function fetchMore(folderId: string, pageToken: string): Promise<void> {
    setIsLoadingMore(true);
    setLoadMoreFailed(false);
    const reply = await requestStorageFolder(
      { folderId, isFoldersOnly: target.isFoldersOnly, pageToken },
      new AbortController().signal,
    );
    setIsLoadingMore(false);

    if (!reply.ok || reply.value.kind !== "browse") {
      setLoadMoreFailed(true);
      return;
    }

    const next = reply.value;
    setReading((current) => appendPage(current, next));
  }

  function loadMore(): void {
    if (!folder?.nextPageToken || isLoadingMore) {
      return;
    }

    void fetchMore(folder.folderId, folder.nextPageToken);
  }

  return { isLoadingMore, loadMore, loadMoreFailed };
}

/**
 * Loads one folder of the connected Google Drive whenever the target changes.
 *
 * @param target - The folder of the address (`null` for the start folder) and
 * whether only folders count.
 * @returns The folder model of the view.
 *
 * @remarks
 * Nothing is kept between visits: every load asks the server, which asks
 * Drive with the rights of the connected account.
 */
export function useStorageFolder(
  target: StorageFolderTarget,
): StorageFolderModel {
  const [reading, setReading] = useState<StorageFolderReading>({
    kind: "loading",
  });
  const [reloadCount, setReloadCount] = useState(0);
  const { folderId, isFoldersOnly } = target;

  useEffect(() => {
    const controller = new AbortController();

    async function load(): Promise<void> {
      setReading({ kind: "loading" });
      const reply = await requestStorageFolder(
        { folderId, isFoldersOnly, pageToken: null },
        controller.signal,
      );

      if (!controller.signal.aborted) {
        setReading(toReading(reply));
      }
    }

    void load();

    return () => controller.abort();
  }, [folderId, isFoldersOnly, reloadCount]);

  function reload(): void {
    setReloadCount((count) => count + 1);
  }

  function replaceStartFolder(startFolder: StorageStartFolder | null): void {
    setReading((current) =>
      current.kind === "loaded"
        ? {
            kind: "loaded",
            result: {
              ...current.result,
              startFolder,
              startFolderProblem: null,
              startFolderRenamedFrom: null,
            },
          }
        : current,
    );
  }

  return {
    ...useMorePages(reading, target, setReading),
    reading,
    reload,
    replaceStartFolder,
  };
}
