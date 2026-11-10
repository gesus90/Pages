import { useEffect, useRef, useState } from "react";
import { useRevalidator } from "react-router";

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
  /** What is known about the asked folder; `loading` until its own answer arrived. */
  readonly reading: StorageFolderReading;
  /**
   * The folder loaded before, while the asked one loads (PAGE-279). It
   * belongs to no current target: a view keeps its place with it, but
   * offers nothing of it.
   */
  readonly previousResult: StorageBrowseResult | null;
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

/** The asked folder with the number of its load. */
interface StorageFolderRequest extends StorageFolderTarget {
  /** Counts up with every change of target and every reload. */
  readonly loadId: number;
}

/** The last answer and the load it belongs to. */
interface StorageFolderState {
  /** The load of the answer; while another load is asked, it is replaced. */
  readonly loadId: number;
  readonly reading: StorageFolderReading;
}

/** A request for the next page, bound to the listing that asked for it. */
interface StoragePageRequest {
  readonly loadId: number;
  readonly folderId: string;
  readonly pageToken: string;
}

/** The next-page request of one listing. */
interface StoragePagesState {
  readonly loadId: number;
  readonly status: "idle" | "loading" | "failed";
}

interface MorePagesOptions {
  readonly state: StorageFolderState;
  readonly loadId: number;
  readonly isFoldersOnly: boolean;
  readonly setState: (
    update: (current: StorageFolderState) => StorageFolderState,
  ) => void;
}

const LOADING: StorageFolderReading = { kind: "loading" };

const NOTHING_LOADED: StorageFolderState = { loadId: 0, reading: LOADING };

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

/** Appends the next page, only to the listing that asked for it. */
function appendPage(
  current: StorageFolderState,
  request: StoragePageRequest,
  next: StorageBrowseResult,
): StorageFolderState {
  const { reading } = current;

  if (reading.kind !== "loaded" || current.loadId !== request.loadId) {
    return current;
  }

  const folder = reading.result.folder;

  // A page of another folder or of a replaced listing never mixes in.
  if (
    !folder ||
    !next.folder ||
    folder.folderId !== request.folderId ||
    folder.nextPageToken !== request.pageToken
  ) {
    return current;
  }

  return {
    loadId: current.loadId,
    reading: {
      kind: "loaded",
      result: {
        ...reading.result,
        folder: {
          ...folder,
          items: [...folder.items, ...next.folder.items],
          nextPageToken: next.folder.nextPageToken,
        },
      },
    },
  };
}

function useMorePages(
  options: MorePagesOptions,
): Pick<StorageFolderModel, "isLoadingMore" | "loadMore" | "loadMoreFailed"> {
  const { state, loadId, isFoldersOnly, setState } = options;
  const [pages, setPages] = useState<StoragePagesState>({
    loadId: 0,
    status: "idle",
  });
  const requestRef = useRef<AbortController | null>(null);
  const status = pages.loadId === loadId ? pages.status : "idle";
  const folder =
    state.loadId === loadId && state.reading.kind === "loaded"
      ? state.reading.result.folder
      : null;

  // Another folder or a reload ends the page request of the former listing.
  useEffect(() => () => requestRef.current?.abort(), [loadId]);

  async function fetchMore(request: StoragePageRequest): Promise<void> {
    const controller = new AbortController();

    requestRef.current = controller;
    setPages({ loadId: request.loadId, status: "loading" });
    const reply = await requestStorageFolder(
      {
        folderId: request.folderId,
        isFoldersOnly,
        pageToken: request.pageToken,
      },
      controller.signal,
    );

    if (controller.signal.aborted) {
      return;
    }

    if (!reply.ok || reply.value.kind !== "browse") {
      setPages({ loadId: request.loadId, status: "failed" });
      return;
    }

    const next = reply.value;
    setPages({ loadId: request.loadId, status: "idle" });
    setState((current) => appendPage(current, request, next));
  }

  function loadMore(): void {
    if (!folder?.nextPageToken || status === "loading") {
      return;
    }

    void fetchMore({
      folderId: folder.folderId,
      loadId,
      pageToken: folder.nextPageToken,
    });
  }

  return {
    isLoadingMore: status === "loading",
    loadMore,
    loadMoreFailed: status === "failed",
  };
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
 * Drive with the rights of the connected account. Each answer belongs to the
 * load that asked for it; an answer or page of a replaced target is dropped
 * (PAGE-279). A failed load lets the frame check session and rights again.
 */
export function useStorageFolder(
  target: StorageFolderTarget,
): StorageFolderModel {
  const [state, setState] = useState<StorageFolderState>(NOTHING_LOADED);
  const [request, setRequest] = useState<StorageFolderRequest>({
    ...target,
    loadId: 1,
  });
  const { revalidate } = useRevalidator();

  // A new target is a new load already in this render, so nothing of the
  // former answer counts as the asked folder, also on a return to it.
  if (
    request.folderId !== target.folderId ||
    request.isFoldersOnly !== target.isFoldersOnly
  ) {
    setRequest({ ...target, loadId: request.loadId + 1 });
  }

  const { folderId, isFoldersOnly, loadId } = request;
  const isCurrent = state.loadId === loadId;

  useEffect(() => {
    const controller = new AbortController();

    async function load(): Promise<void> {
      const reply = await requestStorageFolder(
        { folderId, isFoldersOnly, pageToken: null },
        controller.signal,
      );

      if (controller.signal.aborted) {
        return;
      }

      setState({ loadId, reading: toReading(reply) });
      // The frame reads session and rights again; an ended session leads to the sign-in.
      if (!reply.ok) void revalidate();
    }

    void load();

    return () => controller.abort();
  }, [folderId, isFoldersOnly, loadId, revalidate]);

  function reload(): void {
    setRequest((current) => ({ ...current, loadId: current.loadId + 1 }));
  }

  function replaceStartFolder(startFolder: StorageStartFolder | null): void {
    setState((current) =>
      current.reading.kind === "loaded"
        ? {
            loadId: current.loadId,
            reading: {
              kind: "loaded",
              result: {
                ...current.reading.result,
                startFolder,
                startFolderProblem: null,
                startFolderRenamedFrom: null,
              },
            },
          }
        : current,
    );
  }

  return {
    ...useMorePages({ isFoldersOnly, loadId, setState, state }),
    previousResult:
      !isCurrent && state.reading.kind === "loaded"
        ? state.reading.result
        : null,
    reading: isCurrent ? state.reading : LOADING,
    reload,
    replaceStartFolder,
  };
}
