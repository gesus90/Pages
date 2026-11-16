import { useEffect, useRef } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";

/** The address parameter that names the file the preview shows. */
const FILE_PARAMETER = "file";

/** Marks a history entry that opening a file from the list added. */
const OPENED_FROM_LIST_STATE = { storagePreviewOpenedFromList: true } as const;

/** The attribute of the name link of a file in the list, set by the list itself. */
const FILE_ATTRIBUTE = "data-storage-file";

/** The file of the address; without one the list shows. */
function readFileParameter(searchParams: URLSearchParams): string | null {
  const fileRef = searchParams.get(FILE_PARAMETER)?.trim() ?? "";

  return fileRef === "" ? null : fileRef;
}

function isOpenedFromList(state: unknown): boolean {
  return (
    typeof state === "object" &&
    state !== null &&
    "storagePreviewOpenedFromList" in state &&
    state.storagePreviewOpenedFromList === true
  );
}

function searchOf(searchParams: URLSearchParams): string {
  const search = searchParams.toString();

  return search === "" ? "" : `?${search}`;
}

/** What a link that opens a file in the preview needs. */
export interface StorageFileLink {
  readonly to: string;
  /** Tells the close action that the list is the entry before the preview. */
  readonly state: typeof OPENED_FROM_LIST_STATE;
}

/**
 * The link that opens a file in the preview of Storage.
 * @param searchParams - The parameters of the current address.
 * @param fileRef - The reference of the file.
 * @returns The address, which keeps every parameter of the current one
 * (the folder among them) and adds the file, and the state for the history.
 */
export function storageFileLink(
  searchParams: URLSearchParams,
  fileRef: string,
): StorageFileLink {
  const next = new URLSearchParams(searchParams);

  next.set(FILE_PARAMETER, fileRef);

  return { state: OPENED_FROM_LIST_STATE, to: `/storage${searchOf(next)}` };
}

/** The preview a Storage address asks for, and the way out of it. */
export interface StoragePreviewRoute {
  /** The reference of the file to preview; `null` while the list shows. */
  readonly fileRef: string | null;
  /** Leaves the preview for the list. */
  readonly close: () => void;
}

/**
 * Reads the preview from the address and closes it with the history.
 * @returns The file to preview and the close action.
 * @remarks
 * Closing steps back when the entry before the preview is the list that
 * opened it, so Back, Close and Escape agree. A direct link has no such entry;
 * closing then removes only `file` from the address in place, so it never
 * leaves Pages and keeps the folder.
 */
export function useStoragePreviewRoute(): StoragePreviewRoute {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();

  function close(): void {
    if (isOpenedFromList(location.state)) {
      void navigate(-1);
      return;
    }

    const next = new URLSearchParams(searchParams);

    next.delete(FILE_PARAMETER);
    void navigate({ search: searchOf(next) }, { replace: true });
  }

  return { close, fileRef: readFileParameter(searchParams) };
}

/**
 * Gives the focus back to the name of the file the preview closed on.
 * @param fileRef - The reference of the file the address names, or `null`.
 */
export function useRestoreListFocus(fileRef: string | null): void {
  const shownRef = useRef<string | null>(null);

  useEffect(() => {
    const closedRef = shownRef.current;

    shownRef.current = fileRef;

    if (fileRef !== null || closedRef === null) return;

    document
      .querySelector<HTMLElement>(
        `[${FILE_ATTRIBUTE}="${CSS.escape(closedRef)}"]`,
      )
      ?.focus({ preventScroll: true });
  }, [fileRef]);
}
