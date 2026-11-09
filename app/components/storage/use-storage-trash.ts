import { useEffect, useState } from "react";

import { requestStorageTrash } from "./storage-actions-requests";

import type { StorageEntry, StorageError } from "@/definition/GoogleDriveFiles";

/** What the trash view knows. */
export type StorageTrashReading =
  | { readonly kind: "loading" }
  | { readonly kind: "failed"; readonly error: StorageError }
  | {
      readonly kind: "loaded";
      readonly entries: readonly StorageEntry[];
      readonly nextPageToken: string | null;
    };

/** The trash listing and how to move through it. */
export interface StorageTrashModel {
  readonly reading: StorageTrashReading;
  readonly isLoadingMore: boolean;
  readonly loadMore: () => void;
  readonly reload: () => void;
}

/**
 * Loads the trash of the connected Drive: the entries put into it themselves,
 * which are the ones that can be restored.
 *
 * @returns The trash model of the view.
 */
export function useStorageTrash(): StorageTrashModel {
  const [reading, setReading] = useState<StorageTrashReading>({
    kind: "loading",
  });
  const [reloadCount, setReloadCount] = useState(0);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    async function load(): Promise<void> {
      setReading({ kind: "loading" });
      const reply = await requestStorageTrash(null, controller.signal);

      if (controller.signal.aborted) return;

      setReading(
        reply.ok
          ? { kind: "loaded", ...reply.value }
          : { error: reply.error, kind: "failed" },
      );
    }

    void load();

    return () => controller.abort();
  }, [reloadCount]);

  async function fetchMore(
    entries: readonly StorageEntry[],
    pageToken: string,
  ): Promise<void> {
    setIsLoadingMore(true);
    const reply = await requestStorageTrash(
      pageToken,
      new AbortController().signal,
    );
    setIsLoadingMore(false);

    if (reply.ok) {
      setReading({
        entries: [...entries, ...reply.value.entries],
        kind: "loaded",
        nextPageToken: reply.value.nextPageToken,
      });
    }
  }

  function loadMore(): void {
    if (reading.kind === "loaded" && reading.nextPageToken && !isLoadingMore) {
      void fetchMore(reading.entries, reading.nextPageToken);
    }
  }

  return {
    isLoadingMore,
    loadMore,
    reading,
    reload: () => setReloadCount((count) => count + 1),
  };
}
