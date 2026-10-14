import { useEffect, useState } from "react";
import { useFetcher } from "react-router";

import type { WorkspaceFolderListing } from "@/definition/AgentWorkspace";

type FolderResponse =
  WorkspaceFolderListing | { readonly ok: false; readonly error: string };

interface FolderTarget {
  readonly path: string | null;
  readonly showHidden: boolean;
}

/**
 * Loads one level of server directories at a time.
 *
 * @remarks
 * The last level that loaded stays available while a request fails, so the
 * way back through its breadcrumb is still there next to the error.
 */
export function useFolderBrowser(startPath: string | null): {
  readonly listing: WorkspaceFolderListing | null;
  readonly errorCode: string | null;
  /** The path whose request failed, or `null` for a failed start at the roots. */
  readonly failedPath: string | null;
  readonly isLoading: boolean;
  readonly showHidden: boolean;
  readonly open: (path: string | null) => void;
  readonly reload: () => void;
  readonly setShowHidden: (showHidden: boolean) => void;
} {
  const fetcher = useFetcher<FolderResponse>();
  const { load } = fetcher;
  const [target, setTarget] = useState<FolderTarget>({
    path: startPath,
    showHidden: false,
  });
  const [lastListing, setLastListing] = useState<WorkspaceFolderListing | null>(
    null,
  );
  useEffect(() => {
    const query = new URLSearchParams();
    if (target.path !== null) query.set("path", target.path);
    if (target.showHidden) query.set("hidden", "1");
    void load(`/agent-api/workspace-folders?${query.toString()}`);
  }, [target, load]);
  const response = fetcher.data;
  const loaded = response && "folders" in response ? response : null;
  if (loaded !== null && loaded !== lastListing) setLastListing(loaded);
  const errorCode = response && "error" in response ? response.error : null;
  return {
    listing: loaded ?? lastListing,
    errorCode,
    failedPath: errorCode === null ? null : target.path,
    isLoading: fetcher.state !== "idle" || response === undefined,
    showHidden: target.showHidden,
    open: (path) => setTarget({ ...target, path }),
    reload: () => setTarget({ ...target }),
    setShowHidden: (showHidden) => setTarget({ ...target, showHidden }),
  };
}
