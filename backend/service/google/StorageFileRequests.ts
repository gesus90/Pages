import type {
  StorageConfirmableAction,
  StorageConflictPolicy,
  StorageEntry,
  StorageScope,
} from "@/definition/GoogleDriveFiles";

/** The account of a changing call. */
export interface StorageActor {
  readonly userId: string;
}

/** A new folder. */
export interface StorageCreateFolderRequest extends StorageActor {
  readonly parentRef: string;
  readonly name: string;
  readonly onConflict: StorageConflictPolicy;
}

/** A new file with its bytes. */
export interface StorageUploadRequest extends StorageActor {
  readonly parentRef: string;
  readonly name: string;
  readonly mimeType: string;
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly onConflict: StorageConflictPolicy;
  /** The confirmation of an overwrite, else `null`. */
  readonly confirmation: string | null;
}

/** New bytes for an existing file. */
export interface StorageUpdateRequest extends StorageActor {
  readonly ref: string;
  readonly mimeType: string;
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly confirmation: string | null;
}

/** A copy of a file or a folder tree. */
export interface StorageCopyRequest extends StorageActor {
  readonly ref: string;
  /** The target folder; `null` keeps the folder of the original. */
  readonly targetParentRef: string | null;
  /** The name of the copy; `null` keeps the original name. */
  readonly name: string | null;
  readonly onConflict: StorageConflictPolicy;
}

/** A move into another folder. */
export interface StorageMoveRequest extends StorageActor {
  readonly ref: string;
  readonly targetParentRef: string;
  readonly onConflict: StorageConflictPolicy;
}

/** A new name. */
export interface StorageRenameRequest extends StorageActor {
  readonly ref: string;
  readonly name: string;
  readonly onConflict: StorageConflictPolicy;
}

/** An action on one entry that may need a confirmation. */
export interface StorageEntryActionRequest extends StorageActor {
  readonly ref: string;
  readonly confirmation: string | null;
}

/** A request for a confirmation before an action. */
export interface StorageConfirmRequest extends StorageActor {
  readonly ref: string;
  readonly action: StorageConfirmableAction;
}

/** The result of a copy. */
export interface StorageCopyResult {
  readonly entry: StorageEntry;
  /** How many entries were created, the copy itself included. */
  readonly copiedCount: number;
}

/** The result of a permanent deletion. */
export interface StorageDeletion {
  readonly ref: string;
  readonly name: string;
  readonly scope: StorageScope | null;
}
