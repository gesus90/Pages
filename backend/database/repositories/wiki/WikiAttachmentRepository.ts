import { randomUUID } from "node:crypto";

import {
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";

import { readCount } from "./WikiPageRows";

import type { DatabaseTransaction } from "@/backend/database/Database";

/** Values of an attachment that is stored. */
export interface NewWikiAttachment {
  readonly pageId: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly kind: "media" | "file";
  readonly size: number;
  readonly checksum: string;
  readonly storageName: string;
  readonly uploadedBy: string;
}

/** An attachment as stored, with the name of the stored file. */
export interface StoredWikiAttachment extends NewWikiAttachment {
  readonly id: string;
  readonly uploadedByName: string;
  readonly createdAt: string;
}

const COLUMNS = `
    attachment.id,
    attachment.page_id,
    attachment.file_name,
    attachment.content_type,
    attachment.kind,
    attachment.size,
    attachment.checksum,
    attachment.storage_name,
    attachment.uploaded_by,
    uploader.display_name,
    attachment.created_at
`;

function readAttachment(
  row: readonly (string | number | bigint | Buffer | null)[],
): StoredWikiAttachment {
  const kind = readTextColumn(row, 4, "kind");

  return {
    checksum: readTextColumn(row, 6, "checksum"),
    contentType: readTextColumn(row, 3, "content_type"),
    createdAt: readTextColumn(row, 10, "created_at"),
    fileName: readTextColumn(row, 2, "file_name"),
    id: readTextColumn(row, 0, "id"),
    kind: kind === "media" ? "media" : "file",
    pageId: readTextColumn(row, 1, "page_id"),
    size: readCount(row, 5, "size"),
    storageName: readTextColumn(row, 7, "storage_name"),
    uploadedBy: readTextColumn(row, 8, "uploaded_by"),
    uploadedByName: readNullableTextColumn(row, 9, "uploader_name") ?? "",
  };
}

/** Owns the metadata of attached files; the files themselves are on disk. */
export class WikiAttachmentRepository {
  private readonly database: DatabaseTransaction;

  /**
   * Creates the repository.
   *
   * @param database - Database access or the transaction to run in.
   */
  public constructor(database: DatabaseTransaction) {
    this.database = database;
  }

  /**
   * Stores the metadata of an attached file.
   *
   * @param attachment - What the server knows about the file.
   * @returns The identifier and the creation time of the attachment.
   */
  public async insert(
    attachment: NewWikiAttachment,
  ): Promise<{ id: string; createdAt: string }> {
    const id = randomUUID();
    const [row = []] = await this.database.query(
      `
        INSERT INTO wiki_attachments (
            id,
            page_id,
            file_name,
            content_type,
            kind,
            size,
            checksum,
            storage_name,
            uploaded_by
        )
        VALUES (
            $id,
            $page_id,
            $file_name,
            $content_type,
            $kind,
            $size,
            $checksum,
            $storage_name,
            $uploaded_by
        )
        RETURNING created_at;
      `,
      {
        checksum: attachment.checksum,
        content_type: attachment.contentType,
        file_name: attachment.fileName,
        id,
        kind: attachment.kind,
        page_id: attachment.pageId,
        size: attachment.size,
        storage_name: attachment.storageName,
        uploaded_by: attachment.uploadedBy,
      },
    );

    return { createdAt: readTextColumn(row, 0, "created_at"), id };
  }

  /**
   * Lists the attachments of a page.
   *
   * @param pageId - Page identifier.
   * @returns The attachments, oldest first.
   */
  public async listByPage(pageId: string): Promise<StoredWikiAttachment[]> {
    const rows = await this.database.query(
      `
        SELECT ${COLUMNS}
        FROM wiki_attachments AS attachment
        LEFT JOIN users AS uploader
            ON uploader.id = attachment.uploaded_by
        WHERE attachment.page_id = $page_id
        ORDER BY attachment.created_at, attachment.file_name, attachment.id;
      `,
      { page_id: pageId },
    );

    return rows.map(readAttachment);
  }

  /**
   * Reads one attachment.
   *
   * @param id - Attachment identifier.
   * @returns The attachment, or `null`.
   */
  public async find(id: string): Promise<StoredWikiAttachment | null> {
    const rows = await this.database.query(
      `
        SELECT ${COLUMNS}
        FROM wiki_attachments AS attachment
        LEFT JOIN users AS uploader
            ON uploader.id = attachment.uploaded_by
        WHERE attachment.id = $id;
      `,
      { id },
    );
    const [row] = rows;

    return row ? readAttachment(row) : null;
  }

  /**
   * Removes the metadata of an attachment.
   *
   * @param id - Attachment identifier.
   */
  public async delete(id: string): Promise<void> {
    await this.database.execute(
      "DELETE FROM wiki_attachments WHERE id = $id;",
      {
        id,
      },
    );
  }

  /**
   * Lists the names of every file the database refers to.
   *
   * @returns Storage names.
   */
  public async listStorageNames(): Promise<string[]> {
    const rows = await this.database.query(
      "SELECT storage_name FROM wiki_attachments;",
    );

    return rows.map((row) => readTextColumn(row, 0, "storage_name"));
  }
}
