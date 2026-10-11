import {
  readCountColumn,
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";

import type {
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";

/** Internal staging facts, never serialized directly to a client. */
export interface StoredAgentAsset {
  readonly id: string;
  readonly userId: string;
  readonly status: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly kind: "media" | "file";
  readonly size: number;
  readonly checksum: string;
  readonly storageName: string;
  readonly expiresAt: number;
  readonly pageId: string | null;
  readonly attachmentId: string | null;
  readonly createdAt: number;
}

const COLUMNS = `
    id,
    user_id,
    status,
    file_name,
    content_type,
    kind,
    size,
    checksum,
    storage_name,
    expires_at,
    page_id,
    attachment_id,
    created_at
`;

function readAsset(row: readonly DatabaseValue[]): StoredAgentAsset {
  return {
    id: readTextColumn(row, 0, "id"),
    userId: readTextColumn(row, 1, "user_id"),
    status: readTextColumn(row, 2, "status"),
    fileName: readTextColumn(row, 3, "file_name"),
    contentType: readTextColumn(row, 4, "content_type"),
    kind: readTextColumn(row, 5, "kind") === "media" ? "media" : "file",
    size: readCountColumn(row, 6, "size"),
    checksum: readTextColumn(row, 7, "checksum"),
    storageName: readTextColumn(row, 8, "storage_name"),
    expiresAt: readCountColumn(row, 9, "expires_at"),
    pageId: readNullableTextColumn(row, 10, "page_id"),
    attachmentId: readNullableTextColumn(row, 11, "attachment_id"),
    createdAt: readCountColumn(row, 12, "created_at"),
  };
}

/** Persists staging and linking using database or caller-owned transaction access. */
export class AgentAssetRepository {
  private readonly database: DatabaseTransaction;

  public constructor(database: DatabaseTransaction) {
    this.database = database;
  }

  /** Inserts a completed upload; partial uploads never have a row. */
  public async insert(asset: StoredAgentAsset): Promise<void> {
    await this.database.execute(
      `
      INSERT INTO agent_assets (${COLUMNS})
      VALUES ($id, $user_id, 'staged', $file_name, $content_type, $kind, $size,
          $checksum, $storage_name, $expires_at, NULL, NULL, $created_at);
    `,
      {
        id: asset.id,
        user_id: asset.userId,
        file_name: asset.fileName,
        content_type: asset.contentType,
        kind: asset.kind,
        size: asset.size,
        checksum: asset.checksum,
        storage_name: asset.storageName,
        expires_at: asset.expiresAt,
        created_at: asset.createdAt,
      },
    );
  }

  /** Resolves an asset without granting access to it. */
  public async find(id: string): Promise<StoredAgentAsset | null> {
    const [row] = await this.database.query(
      `SELECT ${COLUMNS} FROM agent_assets WHERE id = $id;`,
      { id },
    );
    return row ? readAsset(row) : null;
  }

  /** Links an already validated asset inside the page transaction. */
  public async link(
    id: string,
    pageId: string,
    attachmentId: string,
  ): Promise<void> {
    await this.database.execute(
      `
      UPDATE agent_assets
      SET status = 'linked', page_id = $page_id, attachment_id = $attachment_id
      WHERE id = $id;
    `,
      { id, page_id: pageId, attachment_id: attachmentId },
    );
  }

  /** Returns expired staging, including prior failed cleanup attempts. */
  public async expired(now: number): Promise<StoredAgentAsset[]> {
    return (
      await this.database.query(
        `
      SELECT ${COLUMNS}
      FROM agent_assets
      WHERE status <> 'linked'
          AND expires_at <= $now;
    `,
        { now },
      )
    ).map(readAsset);
  }

  /** Marks a row inaccessible before attempting file removal. */
  public async markExpired(id: string): Promise<void> {
    await this.database.execute(
      "UPDATE agent_assets SET status = 'expired' WHERE id = $id;",
      { id },
    );
  }

  /** Deletes metadata only after its file was successfully removed. */
  public async remove(id: string): Promise<void> {
    await this.database.execute("DELETE FROM agent_assets WHERE id = $id;", {
      id,
    });
  }

  /** Keeps live staged files safe from orphan sweeping. */
  public async stagedStorageNames(): Promise<string[]> {
    const rows = await this.database.query(
      "SELECT storage_name FROM agent_assets WHERE status = 'staged';",
    );
    return rows.map((row) => readTextColumn(row, 0, "storage_name"));
  }
}
