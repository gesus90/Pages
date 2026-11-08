import type {
  GoogleDriveConnectionState,
  GoogleDriveProblem,
} from "@/definition/GoogleDrive";

/** The virtual folder that lists the shared drives of the account. */
export const STORAGE_SHARED_DRIVES_ID = "shared-drives";

/** The Drive alias of the My Drive root folder. */
export const STORAGE_MY_DRIVE_ID = "root";

/**
 * How far the granted scopes of the connection reach into Drive.
 *
 * - `full`: a read scope covers every folder the Google account can open.
 * - `app_files`: only `drive.file`; Drive shows just the files Pages created
 *   or opened, not the existing folder tree.
 */
export type StorageAccessReach = "full" | "app_files";

/** One folder or file of a listing; never contains a token. */
export interface StorageItem {
  readonly id: string;
  readonly name: string;
  readonly isFolder: boolean;
  readonly mimeType: string;
  /** ISO time of the last change, when Drive names it. */
  readonly modifiedAt: string | null;
  /** Size in bytes; Google Docs and folders have none. */
  readonly sizeBytes: number | null;
  /** Google's own page of the item; the person signs in to Google there. */
  readonly webViewLink: string | null;
}

/**
 * What a step of the path is.
 *
 * - `my_drive`: the root of My Drive; the view names it in its language.
 * - `shared_drives`: the list of shared drives; the view names it.
 * - `shared_drive`: the root folder of one shared drive, with its name.
 * - `folder`: an ordinary folder, with its name.
 * - `detached`: the path goes on above, but Drive does not show it to the
 *   account (for example a folder shared with it); not clickable.
 */
export type StoragePathRole =
  "my_drive" | "shared_drives" | "shared_drive" | "folder" | "detached";

/** One step of the path from the root to the shown folder. */
export interface StoragePathEntry {
  readonly id: string;
  readonly name: string;
  readonly role: StoragePathRole;
}

/** Why a folder could not be shown. */
export type StorageFolderProblem =
  | "not_found"
  | "trashed"
  | "not_folder"
  | "forbidden"
  | "scope_insufficient"
  | "unreachable";

/** The saved start folder as the person sees it. */
export interface StorageStartFolder {
  readonly folderId: string;
  readonly name: string;
  /** The readable path as it was last read from Drive; the folder is found by its identifier only. */
  readonly path: readonly StoragePathEntry[];
}

/**
 * Why the saved start folder was not opened.
 *
 * - `other_account`: it was saved for another Google account of the connection.
 * - every {@link StorageFolderProblem}: Drive refused or no longer has it.
 */
export type StorageStartFolderProblem = StorageFolderProblem | "other_account";

/** A shown folder with its path and one page of its content. */
export interface StorageFolderView {
  readonly folderId: string;
  readonly name: string;
  readonly path: readonly StoragePathEntry[];
  readonly items: readonly StorageItem[];
  /** Opaque Google cursor of the next page, `null` on the last page. */
  readonly nextPageToken: string | null;
  /** Whether the start folder can be saved here; the shared-drive list is no folder. */
  readonly canBeStartFolder: boolean;
}

/** The answer when the Drive connection is not usable. */
export interface StorageConnectionUnavailable {
  readonly kind: "connection";
  readonly state: Exclude<GoogleDriveConnectionState, "connected">;
  readonly problem: GoogleDriveProblem | null;
}

/** The answer of a folder request with a usable connection. */
export interface StorageBrowseResult {
  readonly kind: "browse";
  readonly accountEmail: string | null;
  readonly reach: StorageAccessReach;
  /** Whether shared drives are offered; only a read scope lists them. */
  readonly hasSharedDrives: boolean;
  readonly startFolder: StorageStartFolder | null;
  /** Set when the saved start folder was asked for and not shown. */
  readonly startFolderProblem: StorageStartFolderProblem | null;
  /** The former name when Drive reports a renamed start folder. */
  readonly startFolderRenamedFrom: string | null;
  /** Why the asked folder is not shown; `folder` is `null` then. */
  readonly folderProblem: StorageFolderProblem | null;
  readonly folder: StorageFolderView | null;
}

/** Every answer of a folder request. */
export type StorageBrowseResponse =
  StorageBrowseResult | StorageConnectionUnavailable;

/**
 * The storage quota of the Google account, as Drive `about.get` names it.
 *
 * @remarks
 * `usageBytes` is the use across all Google services, not the size of a
 * folder. `limitBytes` is `null` when Drive names no limit (unlimited).
 * In an organization with pooled storage the limit is the one of the pool,
 * so `isPossiblyPooled` asks the view to name it that way.
 */
export interface StorageQuota {
  readonly usageBytes: number;
  readonly usageInDriveBytes: number | null;
  readonly limitBytes: number | null;
  readonly isPossiblyPooled: boolean;
}

/** Every answer of the quota request. */
export type StorageQuotaResponse =
  | { readonly kind: "quota"; readonly quota: StorageQuota }
  | { readonly kind: "quota_unavailable" }
  | StorageConnectionUnavailable;

/** The answer of saving or clearing the start folder. */
export type StorageStartFolderSaveResult =
  | { readonly ok: true; readonly startFolder: StorageStartFolder | null }
  | {
      readonly ok: false;
      readonly error: StorageFolderProblem | "connection" | "invalid";
    };
