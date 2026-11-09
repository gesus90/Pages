import type {
  GoogleDriveConnectionState,
  GoogleDriveProblem,
} from "@/definition/GoogleDrive";

/**
 * Every operation of the Storage interface `/storage-api/v1/:operation`
 * (PAGE-270), see `docs/StorageApi.md`.
 */
export const STORAGE_OPERATIONS = [
  "list",
  "search",
  "stat",
  "resolve_path",
  "read",
  "download",
  "upload",
  "update",
  "copy",
  "move",
  "rename",
  "delete",
  "create_folder",
  "restore",
  "quota",
  "capabilities",
  "delete_permanently",
  "confirm",
  "batch",
] as const;

/** One operation of the Storage interface. */
export type StorageOperation = (typeof STORAGE_OPERATIONS)[number];

/** The operations that only read; every other one changes Drive. */
export const STORAGE_READ_OPERATIONS: readonly StorageOperation[] = [
  "list",
  "search",
  "stat",
  "resolve_path",
  "read",
  "download",
  "quota",
  "capabilities",
];

/** The actions a confirmation can be issued for. */
export type StorageConfirmableAction =
  "delete" | "delete_permanently" | "update" | "overwrite";

/**
 * What happens when the target folder already holds an entry of the same name.
 *
 * - `fail`: refuse with `name_conflict` (the default; nothing is overwritten).
 * - `keep_both`: add a free suffix such as ` (2)` to the new name.
 * - `overwrite`: replace the content of the one existing file; upload only,
 *   and only with a confirmation bound to that file.
 */
export type StorageConflictPolicy = "fail" | "keep_both" | "overwrite";

/** One folder or file as the Storage interface names it; never contains a token. */
export interface StorageEntry {
  /**
   * The direct reference of the object: Drive's file identifier. It stays the
   * same after a rename or a move, grants nothing and is no sharing link.
   */
  readonly ref: string;
  readonly name: string;
  readonly isFolder: boolean;
  readonly mimeType: string;
  /** A Google Docs, Sheets, Slides or Drawings document: no bytes of its own, only exports. */
  readonly isGoogleDocument: boolean;
  readonly isTrashed: boolean;
  /** Put in the trash itself, not only with a folder above it; only such an entry can be restored. */
  readonly isExplicitlyTrashed: boolean;
  /** ISO time of the last change, when Drive names it. */
  readonly modifiedAt: string | null;
  /** Size in bytes; Google documents and folders have none. */
  readonly sizeBytes: number | null;
  /** The first parent folder, `null` for a root or an entry without visible parent. */
  readonly parentRef: string | null;
  /** The shared drive of the entry, `null` in My Drive. */
  readonly driveRef: string | null;
  /** Drive's change counter; a confirmation is bound to it. */
  readonly version: string | null;
  /** Google's own page of the entry; the person signs in to Google there. */
  readonly webViewLink: string | null;
  /** The formats `read` and `download` accept for a Google document, else empty. */
  readonly exportFormats: readonly string[];
}

/** One page of a listing or a search. */
export interface StorageEntryPage {
  readonly entries: readonly StorageEntry[];
  /** Opaque cursor of the next page, `null` on the last page. */
  readonly nextPageToken: string | null;
}

/** How many entries a folder action reaches, counted before it runs. */
export interface StorageScope {
  readonly folderCount: number;
  readonly fileCount: number;
  readonly totalBytes: number;
  /** Set when the count stopped at its limit; the real scope is larger. */
  readonly isTruncated: boolean;
}

/**
 * A one-time confirmation for a destructive action.
 *
 * @remarks
 * The server keeps it bound to the account, the action, the object and the
 * object's current state (version, and the scope of a folder). It expires
 * after `expiresAt` and is spent by the first use.
 */
export interface StorageConfirmation {
  readonly token: string;
  readonly action: StorageConfirmableAction;
  readonly target: StorageEntry;
  /** The reached content of a folder; `null` for a file. */
  readonly scope: StorageScope | null;
  /** ISO time after which the token is refused. */
  readonly expiresAt: string;
}

/** What the connected account and this instance allow right now. */
export interface StorageCapabilities {
  readonly canRead: boolean;
  /** Whether the granted Google scopes allow changes. */
  readonly canWrite: boolean;
  /** Whether a targeted consent for write access can be started in the system settings. */
  readonly canRequestWriteAccess: boolean;
  readonly maxUploadBytes: number;
  readonly maxReadBytes: number;
  readonly pageSizeLimit: number;
  readonly operations: readonly StorageOperation[];
  /** Export formats per Google document type. */
  readonly exportFormats: Readonly<Record<string, readonly string[]>>;
  readonly isSimulation: boolean;
}

/** The storage quota as `about.get` names it. */
export interface StorageQuotaReading {
  readonly usageBytes: number;
  readonly usageInDriveBytes: number | null;
  readonly usageInTrashBytes: number | null;
  /** `null` when Drive names no limit. */
  readonly limitBytes: number | null;
}

/** The text content of a file, inline and limited. */
export interface StorageReadContent {
  readonly entry: StorageEntry;
  /** The format the text was exported as, or the file's own type. */
  readonly mimeType: string;
  readonly text: string;
}

/**
 * Why a Storage call failed. Each code maps to one HTTP status, see
 * `docs/StorageApi.md`.
 */
export type StorageErrorCode =
  | "forbidden"
  | "invalid_request"
  | "invalid_reference"
  | "invalid_path"
  | "not_found"
  | "trashed"
  | "not_trashed"
  | "not_folder"
  | "is_folder"
  | "ambiguous_path"
  | "name_conflict"
  | "confirmation_required"
  | "confirmation_invalid"
  | "unsupported_operation"
  | "too_large"
  | "provider_forbidden"
  | "provider_scope_missing"
  | "connection_unavailable"
  | "provider_unreachable"
  | "failed";

/** The details of a failed Storage call; never contains a token or file content. */
export interface StorageError {
  readonly code: StorageErrorCode;
  /** Set for `connection_unavailable`. */
  readonly connectionState?: Exclude<GoogleDriveConnectionState, "connected">;
  readonly connectionProblem?: GoogleDriveProblem | null;
  /** Set for `name_conflict`: the entries that already carry the name. */
  readonly conflicts?: readonly StorageEntry[];
  /** Set for `ambiguous_path`: the entries the path step matches. */
  readonly candidates?: readonly StorageEntry[];
  /** Set for `confirmation_required`. */
  readonly confirmation?: StorageConfirmation;
  /** Set for `provider_scope_missing`: where a person grants the missing access. */
  readonly consentPath?: string;
  /** Set for `unsupported_operation` on Google documents. */
  readonly exportFormats?: readonly string[];
  /** Set for `too_large`. */
  readonly limitBytes?: number;
}

/** The outcome of one Storage call inside the server. */
export type StorageResult<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly error: StorageError };

/** The most entries one `batch` call changes (PAGE-272). */
export const STORAGE_BATCH_LIMIT = 100;

/** What one `batch` call does with every entry it names. */
export type StorageBatchAction = "copy" | "move" | "delete";

/** One entry a `batch` call could not change. */
export interface StorageBatchFailure {
  readonly ref: string;
  readonly code: StorageErrorCode;
}

/**
 * The outcome of a `batch` call: the other entries go on when one fails.
 *
 * @remarks
 * `failures` names every refused entry with its reason, so the view can say
 * how many were refused and why.
 */
export interface StorageBatchResult {
  readonly action: StorageBatchAction;
  readonly succeeded: number;
  readonly failures: readonly StorageBatchFailure[];
}
