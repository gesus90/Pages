/** A folder-scoped Storage write grant; descendants inherit it. */
export interface StorageGrant {
  readonly permissionId: string;
  readonly folderRef: string;
  readonly folderName: string;
  readonly targetKind: "role" | "department" | "group";
  readonly targetId: string;
}

/** One successful Storage operation, attributed to the acting account. */
export interface StorageActivity {
  readonly actorId: string;
  readonly actorName: string;
  readonly operation: string;
  readonly ref: string;
  readonly createdAt: string;
}

/** A selectable recipient of a folder grant. */
export interface StorageGrantTarget {
  readonly kind: StorageGrant["targetKind"];
  readonly id: string;
  readonly name: string;
}
