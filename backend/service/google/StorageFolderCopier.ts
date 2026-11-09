import {
  countFolderScope,
  driveFailure,
  storageFailure,
} from "@/backend/service/google/StorageFileSupport";

import type { StorageCopyResult } from "@/backend/service/google/StorageFileRequests";
import type {
  StorageDriveClient,
  StorageSession,
} from "@/backend/service/google/StorageFileSupport";
import type {
  StorageEntry,
  StorageResult,
} from "@/definition/GoogleDriveFiles";

/** A folder copy reaches at most this many entries; Drive copies folders only entry by entry. */
const MAXIMUM_FOLDER_COPY_ENTRIES = 500;

const MAXIMUM_ANCESTOR_STEPS = 30;

/**
 * Copies folder trees for the Storage interface (PAGE-270).
 *
 * @remarks
 * Drive copies no folders (it answers `403 cannotCopyFile`), so a folder copy
 * creates each folder and copies each file one by one, outside the trash.
 */
export class StorageFolderCopier {
  private readonly drive: StorageDriveClient;

  /**
   * Creates the copier.
   *
   * @param drive - The Drive client.
   */
  public constructor(drive: StorageDriveClient) {
    this.drive = drive;
  }

  /**
   * Copies a folder tree entry by entry into a target folder.
   *
   * @param session - The access of the call.
   * @param input - Original folder, target folder and the name of the copy.
   * @returns The new folder and how many entries were created; `too_large`
   * above the copy limit, before anything is created.
   */
  public async copyFolder(
    session: StorageSession,
    input: {
      readonly source: StorageEntry;
      readonly target: StorageEntry;
      readonly name: string;
    },
  ): Promise<StorageResult<StorageCopyResult>> {
    if (await this.isWithin(session, input.target, input.source.ref)) {
      return storageFailure("invalid_request");
    }

    const scope = await countFolderScope(this.drive, session, input.source);

    if (!scope.ok) return scope;

    const size = scope.value.fileCount + scope.value.folderCount;

    if (scope.value.isTruncated || size > MAXIMUM_FOLDER_COPY_ENTRIES) {
      return storageFailure("too_large");
    }

    const root = await this.drive.createFolder(session.accessToken, {
      name: input.name,
      parentId: input.target.ref,
    });

    if (!root.ok) return driveFailure(root);

    const copied = await this.copyChildren(session, {
      driveId: input.source.driveRef,
      fromRef: input.source.ref,
      toRef: root.value.ref,
    });

    return copied.ok
      ? {
          ok: true,
          value: { copiedCount: copied.value + 1, entry: root.value },
        }
      : copied;
  }

  /**
   * Tells whether a folder is an entry itself or lies below it.
   *
   * @param session - The access of the call.
   * @param folder - The folder.
   * @param ancestorRef - The entry.
   * @returns Whether moving or copying the entry into the folder would nest it in itself.
   */
  public async isWithin(
    session: StorageSession,
    folder: StorageEntry,
    ancestorRef: string,
  ): Promise<boolean> {
    let current: StorageEntry = folder;

    for (let step = 0; step < MAXIMUM_ANCESTOR_STEPS; step += 1) {
      if (current.ref === ancestorRef) return true;
      if (current.parentRef === null) return false;

      const parent = await this.drive.stat(
        session.accessToken,
        current.parentRef,
      );

      if (!parent.ok) return false;

      current = parent.value;
    }

    return true;
  }

  private async copyChildren(
    session: StorageSession,
    input: {
      readonly fromRef: string;
      readonly toRef: string;
      readonly driveId: string | null;
    },
  ): Promise<StorageResult<number>> {
    let pageToken: string | null = null;
    let copiedCount = 0;

    do {
      const page = await this.drive.query(session.accessToken, {
        driveId: input.driveId,
        pageSize: 1000,
        pageToken,
        query: `'${input.fromRef}' in parents and trashed = false`,
      });

      if (!page.ok) return driveFailure(page);

      for (const child of page.value.entries) {
        const copied = await this.copyChild(session, {
          child,
          driveId: input.driveId,
          toRef: input.toRef,
        });

        if (!copied.ok) return copied;

        copiedCount += copied.value;
      }

      pageToken = page.value.nextPageToken;
    } while (pageToken !== null);

    return { ok: true, value: copiedCount };
  }

  private async copyChild(
    session: StorageSession,
    input: {
      readonly child: StorageEntry;
      readonly toRef: string;
      readonly driveId: string | null;
    },
  ): Promise<StorageResult<number>> {
    if (!input.child.isFolder) {
      const copy = await this.drive.copy(session.accessToken, input.child.ref, {
        name: input.child.name,
        parentId: input.toRef,
      });

      return copy.ok ? { ok: true, value: 1 } : driveFailure(copy);
    }

    const folder = await this.drive.createFolder(session.accessToken, {
      name: input.child.name,
      parentId: input.toRef,
    });

    if (!folder.ok) return driveFailure(folder);

    const copied = await this.copyChildren(session, {
      driveId: input.driveId,
      fromRef: input.child.ref,
      toRef: folder.value.ref,
    });

    return copied.ok ? { ok: true, value: copied.value + 1 } : copied;
  }
}
