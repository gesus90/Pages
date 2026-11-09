import { isGoogleAppsType } from "@/backend/google/GoogleDriveFormats";
import { StorageFolderCopier } from "@/backend/service/google/StorageFolderCopier";
import {
  countFolderScope,
  driveFailure,
  findFreeName,
  findNameConflicts,
  isStorageRef,
  openStorageSession,
  readEntryName,
  readLiveEntry,
  readLiveFolder,
  storageFailure,
  writeRefusal,
} from "@/backend/service/google/StorageFileSupport";

import type {
  StorageActor,
  StorageConfirmRequest,
  StorageCopyRequest,
  StorageCopyResult,
  StorageCreateFolderRequest,
  StorageDeletion,
  StorageEntryActionRequest,
  StorageMoveRequest,
  StorageRenameRequest,
  StorageUpdateRequest,
  StorageUploadRequest,
} from "@/backend/service/google/StorageFileRequests";
import type { StorageConfirmations } from "@/backend/service/google/StorageConfirmations";
import type {
  StorageConnection,
  StorageDriveClient,
  StorageSession,
} from "@/backend/service/google/StorageFileSupport";
import type {
  StorageConfirmableAction,
  StorageConfirmation,
  StorageConflictPolicy,
  StorageEntry,
  StorageResult,
  StorageScope,
} from "@/definition/GoogleDriveFiles";

/** The largest upload or content update Storage accepts; it is held in memory once. */
export const STORAGE_MAX_UPLOAD_BYTES = 64 * 1024 * 1024;

/** A session that may change Drive. */
type WriteSession = StorageResult<StorageSession>;

/**
 * The changing operations of the Storage interface (PAGE-270): upload,
 * update, copy, move, rename, delete (trash), create_folder, restore,
 * delete_permanently and confirm.
 *
 * @remarks
 * Nothing is overwritten silently: a name taken in the target folder fails
 * with `name_conflict` unless the caller chose `keep_both`, and replacing
 * bytes needs a confirmation bound to the file. Deleting moves to the trash;
 * a folder shows its scope and needs a confirmation first. Only
 * `delete_permanently` removes for good, always after a confirmation.
 */
export class StorageFileWriter {
  private readonly connection: StorageConnection;
  private readonly drive: StorageDriveClient;
  private readonly confirmations: StorageConfirmations;
  private readonly copier: StorageFolderCopier;

  /**
   * Creates the writer.
   *
   * @param connection - The Drive connection.
   * @param drive - The Drive client.
   * @param confirmations - The open confirmations.
   */
  public constructor(
    connection: StorageConnection,
    drive: StorageDriveClient,
    confirmations: StorageConfirmations,
  ) {
    this.connection = connection;
    this.drive = drive;
    this.confirmations = confirmations;
    this.copier = new StorageFolderCopier(drive);
  }

  /**
   * Creates a folder.
   *
   * @param request - Parent, name and conflict policy.
   * @returns The new folder.
   */
  public async createFolder(
    request: StorageCreateFolderRequest,
  ): Promise<StorageResult<StorageEntry>> {
    const name = readEntryName(request.name);

    if (name === null) return storageFailure("invalid_request");
    if (request.onConflict === "overwrite")
      return storageFailure("invalid_request");

    const session = await this.openWriteSession();

    if (!session.ok) return session;

    const parent = await readLiveFolder(
      this.drive,
      session.value,
      request.parentRef,
    );

    if (!parent.ok) return parent;

    const placed = await this.placeName(session.value, {
      folder: parent.value,
      name,
      onConflict: request.onConflict,
    });

    if (!placed.ok) return placed;

    const folder = await this.drive.createFolder(session.value.accessToken, {
      name: placed.value,
      parentId: parent.value.ref,
    });

    return folder.ok ? folder : driveFailure(folder);
  }

  /**
   * Uploads a new file, or replaces the one file of the same name after a confirmation.
   *
   * @param request - Parent, name, type, bytes, conflict policy and confirmation.
   * @returns The new or replaced file.
   */
  public async upload(
    request: StorageUploadRequest,
  ): Promise<StorageResult<StorageEntry>> {
    const name = readEntryName(request.name);

    if (name === null) return storageFailure("invalid_request");
    if (request.bytes.length > STORAGE_MAX_UPLOAD_BYTES) {
      return storageFailure("too_large", {
        limitBytes: STORAGE_MAX_UPLOAD_BYTES,
      });
    }

    const session = await this.openWriteSession();

    if (!session.ok) return session;

    const parent = await readLiveFolder(
      this.drive,
      session.value,
      request.parentRef,
    );

    if (!parent.ok) return parent;

    if (request.onConflict === "overwrite") {
      return this.overwrite(session.value, {
        folder: parent.value,
        name,
        request,
      });
    }

    const placed = await this.placeName(session.value, {
      folder: parent.value,
      name,
      onConflict: request.onConflict,
    });

    if (!placed.ok) return placed;

    const file = await this.drive.upload(session.value.accessToken, {
      content: request.bytes,
      mimeType: request.mimeType,
      name: placed.value,
      parentId: parent.value.ref,
    });

    return file.ok ? file : driveFailure(file);
  }

  /**
   * Replaces the bytes of a file after a confirmation bound to its current version.
   *
   * @param request - File, type, bytes and confirmation.
   * @returns The changed file, or `confirmation_required` with the confirmation to show.
   */
  public async update(
    request: StorageUpdateRequest,
  ): Promise<StorageResult<StorageEntry>> {
    if (request.bytes.length > STORAGE_MAX_UPLOAD_BYTES) {
      return storageFailure("too_large", {
        limitBytes: STORAGE_MAX_UPLOAD_BYTES,
      });
    }

    const session = await this.openWriteSession();

    if (!session.ok) return session;

    const file = await this.readReplaceableFile(session.value, request.ref);

    if (!file.ok) return file;

    return this.replaceAfterConfirmation(session.value, {
      action: "update",
      bytes: request.bytes,
      confirmation: request.confirmation,
      file: file.value,
      mimeType: request.mimeType,
      userId: request.userId,
    });
  }

  /**
   * Copies a file, or a folder tree entry by entry.
   *
   * @param request - Original, target folder, name and conflict policy.
   * @returns The copy and how many entries were created.
   */
  public async copy(
    request: StorageCopyRequest,
  ): Promise<StorageResult<StorageCopyResult>> {
    const wantedName =
      request.name === null ? null : readEntryName(request.name);

    if (request.name !== null && wantedName === null)
      return storageFailure("invalid_request");
    if (request.onConflict === "overwrite")
      return storageFailure("invalid_request");

    const session = await this.openWriteSession();

    if (!session.ok) return session;

    const source = await readLiveEntry(this.drive, session.value, request.ref);

    if (!source.ok) return source;

    const targetRef = request.targetParentRef ?? source.value.parentRef;

    if (targetRef === null) return storageFailure("unsupported_operation");

    const target = await readLiveFolder(this.drive, session.value, targetRef);

    if (!target.ok) return target;

    const placed = await this.placeName(session.value, {
      folder: target.value,
      name: wantedName ?? source.value.name,
      onConflict: request.onConflict,
    });

    if (!placed.ok) return placed;

    return source.value.isFolder
      ? this.copier.copyFolder(session.value, {
          name: placed.value,
          source: source.value,
          target: target.value,
        })
      : this.copyFile(session.value, {
          name: placed.value,
          source: source.value,
          target: target.value,
        });
  }

  /**
   * Moves an entry into another folder; its reference stays the same.
   *
   * @param request - Entry, target folder and conflict policy.
   * @returns The moved entry.
   */
  public async move(
    request: StorageMoveRequest,
  ): Promise<StorageResult<StorageEntry>> {
    if (request.onConflict === "overwrite")
      return storageFailure("invalid_request");

    const session = await this.openWriteSession();

    if (!session.ok) return session;

    const source = await readLiveEntry(this.drive, session.value, request.ref);

    if (!source.ok) return source;
    if (source.value.parentRef === null)
      return storageFailure("unsupported_operation");

    const target = await readLiveFolder(
      this.drive,
      session.value,
      request.targetParentRef,
    );

    if (!target.ok) return target;
    if (target.value.ref === source.value.parentRef) return source;
    if (
      await this.copier.isWithin(session.value, target.value, source.value.ref)
    ) {
      return storageFailure("invalid_request");
    }

    const placed = await this.placeName(session.value, {
      exceptRef: source.value.ref,
      folder: target.value,
      name: source.value.name,
      onConflict: request.onConflict,
    });

    if (!placed.ok) return placed;

    const moved = await this.drive.change(
      session.value.accessToken,
      source.value.ref,
      {
        addParentId: target.value.ref,
        removeParentId: source.value.parentRef,
        ...(placed.value === source.value.name ? {} : { name: placed.value }),
      },
    );

    return moved.ok ? moved : driveFailure(moved);
  }

  /**
   * Renames an entry; its reference stays the same.
   *
   * @param request - Entry, new name and conflict policy.
   * @returns The renamed entry.
   */
  public async rename(
    request: StorageRenameRequest,
  ): Promise<StorageResult<StorageEntry>> {
    const name = readEntryName(request.name);

    if (name === null || request.onConflict === "overwrite") {
      return storageFailure("invalid_request");
    }

    const session = await this.openWriteSession();

    if (!session.ok) return session;

    const entry = await readLiveEntry(this.drive, session.value, request.ref);

    if (!entry.ok) return entry;
    if (entry.value.parentRef === null)
      return storageFailure("unsupported_operation");

    const parent = await readLiveFolder(
      this.drive,
      session.value,
      entry.value.parentRef,
    );

    if (!parent.ok) return parent;

    const placed = await this.placeName(session.value, {
      exceptRef: entry.value.ref,
      folder: parent.value,
      name,
      onConflict: request.onConflict,
    });

    if (!placed.ok) return placed;

    const renamed = await this.drive.change(
      session.value.accessToken,
      entry.value.ref,
      {
        name: placed.value,
      },
    );

    return renamed.ok ? renamed : driveFailure(renamed);
  }

  /**
   * Moves an entry to the trash; a folder needs a confirmation that shows its scope.
   *
   * @param request - Entry and confirmation.
   * @returns The entry in the trash.
   */
  public async trash(
    request: StorageEntryActionRequest,
  ): Promise<StorageResult<StorageEntry>> {
    const session = await this.openWriteSession();

    if (!session.ok) return session;

    const entry = await readLiveEntry(this.drive, session.value, request.ref);

    if (!entry.ok) return entry;
    if (entry.value.parentRef === null)
      return storageFailure("unsupported_operation");

    if (entry.value.isFolder) {
      const gate = await this.gate(session.value, {
        action: "delete",
        entry: entry.value,
        token: request.confirmation,
        userId: request.userId,
      });

      if (!gate.ok) return gate;
    }

    const trashed = await this.drive.change(
      session.value.accessToken,
      entry.value.ref,
      {
        isTrashed: true,
      },
    );

    return trashed.ok ? trashed : driveFailure(trashed);
  }

  /**
   * Takes an entry back out of the trash into its former folder.
   *
   * @param request - The entry.
   * @returns The restored entry.
   *
   * @remarks
   * Drive allows equal names, so a restore never replaces another entry; an
   * entry that is only in the trash with a folder above it is restored with
   * that folder.
   */
  public async restore(
    request: StorageActor & { readonly ref: string },
  ): Promise<StorageResult<StorageEntry>> {
    if (!isStorageRef(request.ref)) return storageFailure("invalid_reference");

    const session = await this.openWriteSession();

    if (!session.ok) return session;

    const entry = await this.drive.stat(session.value.accessToken, request.ref);

    if (!entry.ok) return driveFailure(entry);
    if (!entry.value.isTrashed) return storageFailure("not_trashed");
    if (!entry.value.isExplicitlyTrashed)
      return storageFailure("unsupported_operation");

    const restored = await this.drive.change(
      session.value.accessToken,
      entry.value.ref,
      {
        isTrashed: false,
      },
    );

    return restored.ok ? restored : driveFailure(restored);
  }

  /**
   * Deletes an entry for good, a folder with its whole tree, after a confirmation.
   *
   * @param request - Entry and confirmation.
   * @returns What was deleted, or `confirmation_required` with scope and token.
   */
  public async deletePermanently(
    request: StorageEntryActionRequest,
  ): Promise<StorageResult<StorageDeletion>> {
    if (!isStorageRef(request.ref) || request.ref === "root") {
      return storageFailure("invalid_reference");
    }

    const session = await this.openWriteSession();

    if (!session.ok) return session;

    const entry = await this.drive.stat(session.value.accessToken, request.ref);

    if (!entry.ok) return driveFailure(entry);
    if (entry.value.parentRef === null)
      return storageFailure("unsupported_operation");

    const gate = await this.gate(session.value, {
      action: "delete_permanently",
      entry: entry.value,
      token: request.confirmation,
      userId: request.userId,
    });

    if (!gate.ok) return gate;

    const removed = await this.drive.remove(
      session.value.accessToken,
      entry.value.ref,
    );

    return removed.ok
      ? {
          ok: true,
          value: {
            name: entry.value.name,
            ref: entry.value.ref,
            scope: gate.value,
          },
        }
      : driveFailure(removed);
  }

  /**
   * Issues a confirmation before an action, with the scope of a folder.
   *
   * @param request - Entry and action.
   * @returns The confirmation to show and send back with the action.
   */
  public async confirm(
    request: StorageConfirmRequest,
  ): Promise<StorageResult<StorageConfirmation>> {
    if (!isStorageRef(request.ref)) return storageFailure("invalid_reference");

    const session = await this.openWriteSession();

    if (!session.ok) return session;

    const entry = await this.drive.stat(session.value.accessToken, request.ref);

    if (!entry.ok) return driveFailure(entry);

    const scope = await this.scopeOf(session.value, entry.value);

    if (!scope.ok) return scope;

    return {
      ok: true,
      value: this.confirmations.issue({
        action: request.action,
        entry: entry.value,
        scope: scope.value,
        userId: request.userId,
      }),
    };
  }

  private async openWriteSession(): Promise<WriteSession> {
    const session = await openStorageSession(this.connection);

    if (!session.ok) return session;

    return writeRefusal<StorageSession>(session.value) ?? session;
  }

  private async placeName(
    session: StorageSession,
    input: {
      readonly folder: StorageEntry;
      readonly name: string;
      readonly onConflict: StorageConflictPolicy;
      readonly exceptRef?: string;
    },
  ): Promise<StorageResult<string>> {
    const conflicts = await findNameConflicts(this.drive, session, input);

    if (!conflicts.ok) return conflicts;
    if (conflicts.value.length === 0) return { ok: true, value: input.name };

    return input.onConflict === "keep_both"
      ? findFreeName(this.drive, session, input)
      : storageFailure("name_conflict", { conflicts: conflicts.value });
  }

  private async scopeOf(
    session: StorageSession,
    entry: StorageEntry,
  ): Promise<StorageResult<StorageScope | null>> {
    return entry.isFolder
      ? countFolderScope(this.drive, session, entry)
      : { ok: true, value: null };
  }

  /** Lets an action run only with a matching confirmation; otherwise issues one. */
  private async gate(
    session: StorageSession,
    input: {
      readonly action: StorageConfirmableAction;
      readonly entry: StorageEntry;
      readonly token: string | null;
      readonly userId: string;
    },
  ): Promise<StorageResult<StorageScope | null>> {
    const scope = await this.scopeOf(session, input.entry);

    if (!scope.ok) return scope;

    const binding = {
      action: input.action,
      entry: input.entry,
      scope: scope.value,
      userId: input.userId,
    };

    if (input.token === null) {
      return storageFailure("confirmation_required", {
        confirmation: this.confirmations.issue(binding),
      });
    }

    return this.confirmations.consume(input.token, binding)
      ? scope
      : storageFailure("confirmation_invalid", {
          confirmation: this.confirmations.issue(binding),
        });
  }

  private async readReplaceableFile(
    session: StorageSession,
    ref: string,
  ): Promise<StorageResult<StorageEntry>> {
    const file = await readLiveEntry(this.drive, session, ref);

    if (!file.ok) return file;
    if (file.value.isFolder) return storageFailure("is_folder");

    return isGoogleAppsType(file.value.mimeType)
      ? storageFailure("unsupported_operation")
      : file;
  }

  private async overwrite(
    session: StorageSession,
    input: {
      readonly folder: StorageEntry;
      readonly name: string;
      readonly request: StorageUploadRequest;
    },
  ): Promise<StorageResult<StorageEntry>> {
    const conflicts = await findNameConflicts(this.drive, session, input);

    if (!conflicts.ok) return conflicts;

    const [existing, ...others] = conflicts.value;

    if (!existing) {
      return this.upload({ ...input.request, onConflict: "fail" });
    }

    if (others.length > 0) {
      return storageFailure("name_conflict", { conflicts: conflicts.value });
    }

    const file = await this.readReplaceableFile(session, existing.ref);

    if (!file.ok) return file;

    return this.replaceAfterConfirmation(session, {
      action: "overwrite",
      bytes: input.request.bytes,
      confirmation: input.request.confirmation,
      file: file.value,
      mimeType: input.request.mimeType,
      userId: input.request.userId,
    });
  }

  private async replaceAfterConfirmation(
    session: StorageSession,
    input: {
      readonly action: "update" | "overwrite";
      readonly file: StorageEntry;
      readonly bytes: Uint8Array<ArrayBuffer>;
      readonly mimeType: string;
      readonly confirmation: string | null;
      readonly userId: string;
    },
  ): Promise<StorageResult<StorageEntry>> {
    const gate = await this.gate(session, {
      action: input.action,
      entry: input.file,
      token: input.confirmation,
      userId: input.userId,
    });

    if (!gate.ok) return gate;

    const replaced = await this.drive.replaceContent(
      session.accessToken,
      input.file.ref,
      {
        bytes: input.bytes,
        mimeType: input.mimeType,
      },
    );

    return replaced.ok ? replaced : driveFailure(replaced);
  }

  private async copyFile(
    session: StorageSession,
    input: {
      readonly source: StorageEntry;
      readonly target: StorageEntry;
      readonly name: string;
    },
  ): Promise<StorageResult<StorageCopyResult>> {
    const copy = await this.drive.copy(session.accessToken, input.source.ref, {
      name: input.name,
      parentId: input.target.ref,
    });

    return copy.ok
      ? { ok: true, value: { copiedCount: 1, entry: copy.value } }
      : driveFailure(copy);
  }
}
