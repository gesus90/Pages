import { createInClause } from "@/backend/database/repositories/task/InClause";
import {
  readCountColumn,
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";

import type { Database } from "@/backend/database/Database";

/** One stored file of a web export package. */
export interface StoredWebPackageFile {
  readonly path: string;
  /** Name the file store gave the file; never leaves the server. */
  readonly storageName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly sha256: string;
}

/** One start of a player as it is stored. */
export interface StoredWebPackageGrant {
  readonly attachmentId: string;
  readonly userId: string;
  readonly expiresAt: string;
  readonly revokedAt: string | null;
}

type PackageDatabase = Pick<Database, "query" | "execute" | "transaction">;

/**
 * The files and the player starts of web export packages in chats.
 * @remarks
 * A package belongs to its manifest attachment; deleting that removes its
 * file rows and its starts. Callers check membership before they read.
 */
export class ConversationWebPackageRepository {
  private readonly database: PackageDatabase;

  public constructor(database: PackageDatabase) {
    this.database = database;
  }

  /** Stores every file of a package at once; nothing stays when one row fails. */
  public async insertFiles(
    attachmentId: string,
    files: readonly StoredWebPackageFile[],
  ): Promise<void> {
    await this.database.transaction(async (transaction) => {
      for (const file of files)
        await transaction.execute(
          `
            INSERT INTO conversation_web_package_files (
                attachment_id,
                path,
                storage_name,
                mime_type,
                size_bytes,
                sha256
            )
            VALUES (
                $attachment_id,
                $path,
                $storage_name,
                $mime_type,
                $size_bytes,
                $sha256
            );
          `,
          {
            attachment_id: attachmentId,
            path: file.path,
            storage_name: file.storageName,
            mime_type: file.mimeType,
            size_bytes: file.sizeBytes,
            sha256: file.sha256,
          },
        );
    });
  }

  /** The files of a package, by their names in the package. */
  public async files(attachmentId: string): Promise<StoredWebPackageFile[]> {
    const rows = await this.database.query(
      `
        SELECT
            path,
            storage_name,
            mime_type,
            size_bytes,
            sha256
        FROM conversation_web_package_files
        WHERE attachment_id = $attachment_id
        ORDER BY path;
      `,
      { attachment_id: attachmentId },
    );
    return rows.map((row) => ({
      path: readTextColumn(row, 0, "path"),
      storageName: readTextColumn(row, 1, "storage_name"),
      mimeType: readTextColumn(row, 2, "mime_type"),
      sizeBytes: readCountColumn(row, 3, "size_bytes"),
      sha256: readTextColumn(row, 4, "sha256"),
    }));
  }

  /** The storage names of the packages of attachments, read before they are deleted. */
  public async storageNamesOf(
    attachmentIds: readonly string[],
  ): Promise<string[]> {
    if (attachmentIds.length === 0) return [];
    const list = createInClause("attachment", attachmentIds);
    const rows = await this.database.query(
      `
        SELECT storage_name
        FROM conversation_web_package_files
        WHERE attachment_id IN (${list.placeholders});
      `,
      list.parameters,
    );
    return rows.map((row) => readTextColumn(row, 0, "storage_name"));
  }

  /** The storage names of every package whose attachment is still there. */
  public async storageNames(): Promise<Set<string>> {
    const rows = await this.database.query(
      `
        SELECT conversation_web_package_files.storage_name
        FROM conversation_web_package_files
        INNER JOIN conversation_attachments
            ON conversation_attachments.id = conversation_web_package_files.attachment_id
        WHERE conversation_attachments.expired_at IS NULL;
      `,
    );
    return new Set(rows.map((row) => readTextColumn(row, 0, "storage_name")));
  }

  /**
   * Removes the file rows of packages whose attachment expired.
   * @returns The storage names of the removed files.
   */
  public async removeExpired(): Promise<string[]> {
    const rows = await this.database.query(
      `
        DELETE FROM conversation_web_package_files
        USING conversation_attachments
        WHERE conversation_attachments.id = conversation_web_package_files.attachment_id
            AND conversation_attachments.expired_at IS NOT NULL
        RETURNING conversation_web_package_files.storage_name;
      `,
    );
    return rows.map((row) => readTextColumn(row, 0, "storage_name"));
  }

  /** Stores a new start of a player and drops starts that ended a day ago. */
  public async insertGrant(grant: {
    readonly tokenHash: string;
    readonly attachmentId: string;
    readonly userId: string;
    readonly createdAt: string;
    readonly expiresAt: string;
    readonly staleBefore: string;
  }): Promise<void> {
    await this.database.transaction(async (transaction) => {
      await transaction.execute(
        `
          DELETE FROM conversation_web_package_grants
          WHERE expires_at < $stale_before;
        `,
        { stale_before: grant.staleBefore },
      );
      await transaction.execute(
        `
          INSERT INTO conversation_web_package_grants (
              token_hash,
              attachment_id,
              user_id,
              created_at,
              expires_at
          )
          VALUES (
              $token_hash,
              $attachment_id,
              $user_id,
              $created_at,
              $expires_at
          );
        `,
        {
          token_hash: grant.tokenHash,
          attachment_id: grant.attachmentId,
          user_id: grant.userId,
          created_at: grant.createdAt,
          expires_at: grant.expiresAt,
        },
      );
    });
  }

  /** A start of a player by the SHA-256 of its secret, or `null`. */
  public async findGrant(
    tokenHash: string,
  ): Promise<StoredWebPackageGrant | null> {
    const rows = await this.database.query(
      `
        SELECT
            attachment_id,
            user_id,
            expires_at,
            revoked_at
        FROM conversation_web_package_grants
        WHERE token_hash = $token_hash;
      `,
      { token_hash: tokenHash },
    );
    const [row] = rows;
    if (!row) return null;
    return {
      attachmentId: readTextColumn(row, 0, "attachment_id"),
      userId: readTextColumn(row, 1, "user_id"),
      expiresAt: readTextColumn(row, 2, "expires_at"),
      revokedAt: readNullableTextColumn(row, 3, "revoked_at"),
    };
  }

  /**
   * Ends a start of a player of one account.
   * @returns Whether a running start ended.
   */
  public async revokeGrant(
    tokenHash: string,
    userId: string,
    revokedAt: string,
  ): Promise<boolean> {
    const rows = await this.database.query(
      `
        UPDATE conversation_web_package_grants
        SET revoked_at = $revoked_at
        WHERE token_hash = $token_hash
            AND user_id = $user_id
            AND revoked_at IS NULL
        RETURNING token_hash;
      `,
      { token_hash: tokenHash, user_id: userId, revoked_at: revokedAt },
    );
    return rows.length === 1;
  }
}
