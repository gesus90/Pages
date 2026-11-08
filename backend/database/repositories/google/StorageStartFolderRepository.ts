import {
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";

import type { Database } from "@/backend/database/Database";

/** The saved start folder of one account. */
export interface StoredStorageStartFolder {
  readonly userId: string;
  /** The Google account of the connection the folder was saved for. */
  readonly googlePermissionId: string;
  readonly folderId: string;
  readonly driveId: string | null;
  readonly folderName: string;
  readonly folderPath: string;
}

/** Stores the start folder of the Storage area per account (PAGE-188). */
export class StorageStartFolderRepository {
  private readonly database: Pick<Database, "execute" | "query">;

  /**
   * Creates the repository.
   *
   * @param database - Central database access.
   */
  public constructor(database: Pick<Database, "execute" | "query">) {
    this.database = database;
  }

  /**
   * Returns the start folder of an account.
   *
   * @param userId - The account.
   * @returns The saved folder, or `null` when none was saved.
   */
  public async find(userId: string): Promise<StoredStorageStartFolder | null> {
    const [row] = await this.database.query(
      `
        SELECT
            user_id,
            google_permission_id,
            folder_id,
            drive_id,
            folder_name,
            folder_path
        FROM storage_start_folder
        WHERE user_id = $user_id;
      `,
      { user_id: userId },
    );

    if (!row) {
      return null;
    }

    return {
      driveId: readNullableTextColumn(row, 3, "drive_id"),
      folderId: readTextColumn(row, 2, "folder_id"),
      folderName: readTextColumn(row, 4, "folder_name"),
      folderPath: readTextColumn(row, 5, "folder_path"),
      googlePermissionId: readTextColumn(row, 1, "google_permission_id"),
      userId: readTextColumn(row, 0, "user_id"),
    };
  }

  /**
   * Saves the start folder of an account, replacing the previous one.
   *
   * @param folder - Account, Google account, Drive identifiers and the readable name and path.
   * @param savedAt - Unix milliseconds of the change.
   */
  public async save(
    folder: StoredStorageStartFolder,
    savedAt: number,
  ): Promise<void> {
    await this.database.execute(
      `
        INSERT INTO storage_start_folder (
            user_id,
            google_permission_id,
            folder_id,
            drive_id,
            folder_name,
            folder_path,
            saved_at
        )
        VALUES (
            $user_id,
            $google_permission_id,
            $folder_id,
            $drive_id,
            $folder_name,
            $folder_path,
            $saved_at
        )
        ON CONFLICT (user_id) DO UPDATE
        SET
            google_permission_id = EXCLUDED.google_permission_id,
            folder_id = EXCLUDED.folder_id,
            drive_id = EXCLUDED.drive_id,
            folder_name = EXCLUDED.folder_name,
            folder_path = EXCLUDED.folder_path,
            saved_at = EXCLUDED.saved_at;
      `,
      {
        drive_id: folder.driveId,
        folder_id: folder.folderId,
        folder_name: folder.folderName,
        folder_path: folder.folderPath,
        google_permission_id: folder.googlePermissionId,
        saved_at: savedAt,
        user_id: folder.userId,
      },
    );
  }

  /**
   * Refreshes the readable name and path after Drive reported a rename.
   *
   * @param input - Account, the folder it still has to be and the new name and path.
   */
  public async rename(input: {
    readonly userId: string;
    readonly folderId: string;
    readonly folderName: string;
    readonly folderPath: string;
  }): Promise<void> {
    await this.database.execute(
      `
        UPDATE storage_start_folder
        SET
            folder_name = $folder_name,
            folder_path = $folder_path
        WHERE user_id = $user_id
            AND folder_id = $folder_id;
      `,
      {
        folder_id: input.folderId,
        folder_name: input.folderName,
        folder_path: input.folderPath,
        user_id: input.userId,
      },
    );
  }

  /**
   * Removes the start folder of an account.
   *
   * @param userId - The account.
   */
  public async remove(userId: string): Promise<void> {
    await this.database.execute(
      "DELETE FROM storage_start_folder WHERE user_id = $user_id;",
      { user_id: userId },
    );
  }
}
