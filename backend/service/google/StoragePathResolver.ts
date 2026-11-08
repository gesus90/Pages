import {
  STORAGE_MY_DRIVE_ID,
  STORAGE_SHARED_DRIVES_ID,
} from "@/definition/GoogleDriveStorage";

import type {
  DriveFolderMetadata,
  DriveRequestResult,
  GoogleDriveFilesClient,
} from "@/backend/google/GoogleDriveFilesClient";
import type { StoragePathEntry } from "@/definition/GoogleDriveStorage";

/** A folder tree deeper than this is cut off at the top as `detached`. */
const MAXIMUM_PATH_DEPTH = 30;

/** The part of the Drive client the resolver reads with. */
export type StoragePathReader = Pick<
  GoogleDriveFilesClient,
  "readFolder" | "readSharedDriveName"
>;

function folderEntry(folder: DriveFolderMetadata): StoragePathEntry {
  return { id: folder.id, name: folder.name, role: "folder" };
}

const DETACHED_ENTRY: StoragePathEntry = { id: "", name: "", role: "detached" };

/**
 * Builds the path from the root to a folder with the `parents` Drive reports.
 *
 * @remarks
 * Each step asks Drive with the rights of the connected account, so the path
 * never names a folder the account cannot open; where Drive refuses a parent,
 * the path starts with a `detached` step. The root is recognized by identifier,
 * never by name, so a folder that happens to be called like the root is not
 * mistaken for it.
 */
export class StoragePathResolver {
  private readonly reader: StoragePathReader;
  private readonly accessToken: string;
  private myDriveRootId: Promise<string | null> | null = null;

  /**
   * Creates a resolver for one request.
   *
   * @param reader - The Drive client.
   * @param accessToken - The access token of this request; it never leaves the server.
   */
  public constructor(reader: StoragePathReader, accessToken: string) {
    this.reader = reader;
    this.accessToken = accessToken;
  }

  /**
   * Builds the path of a folder.
   *
   * @param folder - The folder as Drive just reported it.
   * @returns The steps from the root down to the folder itself.
   */
  public async resolve(
    folder: DriveFolderMetadata,
  ): Promise<StoragePathEntry[]> {
    const chain = await this.readAncestors(folder);
    const top = chain[0];

    if (!top) {
      return [];
    }

    const rest = chain.slice(1).map(folderEntry);

    if (top.parentId !== null) {
      return [DETACHED_ENTRY, folderEntry(top), ...rest];
    }

    return [...(await this.rootEntries(top)), ...rest];
  }

  /**
   * Names the root of a folder chain.
   *
   * @param top - The topmost folder Drive showed.
   * @returns One or two steps: My Drive, a shared drive below the shared-drive
   * list, or a detached step before a folder without a visible parent.
   */
  private async rootEntries(
    top: DriveFolderMetadata,
  ): Promise<StoragePathEntry[]> {
    if (top.driveId !== null && top.id === top.driveId) {
      const name = await this.reader.readSharedDriveName(
        this.accessToken,
        top.driveId,
      );

      return [
        { id: STORAGE_SHARED_DRIVES_ID, name: "", role: "shared_drives" },
        {
          id: top.id,
          name: name.ok ? name.value : top.name,
          role: "shared_drive",
        },
      ];
    }

    if (top.driveId === null && top.id === (await this.readMyDriveRootId())) {
      return [{ id: top.id, name: "", role: "my_drive" }];
    }

    return [DETACHED_ENTRY, folderEntry(top)];
  }

  private async readAncestors(
    folder: DriveFolderMetadata,
  ): Promise<DriveFolderMetadata[]> {
    const chain: DriveFolderMetadata[] = [folder];
    let current = folder;

    while (current.parentId !== null && chain.length < MAXIMUM_PATH_DEPTH) {
      const parent: DriveRequestResult<DriveFolderMetadata> =
        await this.reader.readFolder(this.accessToken, current.parentId);

      if (!parent.ok) {
        break;
      }

      current = parent.value;
      chain.unshift(current);
    }

    return chain;
  }

  private async readMyDriveRootId(): Promise<string | null> {
    this.myDriveRootId ??= this.reader
      .readFolder(this.accessToken, STORAGE_MY_DRIVE_ID)
      .then((root) => (root.ok ? root.value.id : null));

    return this.myDriveRootId;
  }
}
