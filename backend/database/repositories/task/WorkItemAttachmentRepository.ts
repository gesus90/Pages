import { randomUUID } from "node:crypto";

import { WorkItemNotFoundError } from "@/backend/error/WorkItemErrors";
import {
  readCountColumn,
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";

import { createInClause } from "./InClause";

import type {
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";

/** Values of a ticket attachment that is stored. */
export interface NewWorkItemAttachment {
  readonly workItemId: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly kind: "media" | "file";
  readonly size: number;
  readonly checksum: string;
  readonly storageName: string;
  readonly uploadedBy: string;
}

/** A ticket attachment as stored, with the name of the stored file. */
export interface StoredWorkItemAttachment extends NewWorkItemAttachment {
  readonly id: string;
  readonly uploadedByName: string | null;
  readonly createdAt: string;
}

const COLUMNS = `
    attachment.id,
    attachment.work_item_id,
    attachment.file_name,
    attachment.content_type,
    attachment.kind,
    attachment.size,
    attachment.checksum,
    attachment.storage_name,
    attachment.uploaded_by,
    uploader.display_name AS uploader_name,
    attachment.created_at
`;

function readAttachment(
  row: readonly DatabaseValue[],
): StoredWorkItemAttachment {
  return {
    checksum: readTextColumn(row, 6, "checksum"),
    contentType: readTextColumn(row, 3, "content_type"),
    createdAt: readTextColumn(row, 10, "created_at"),
    fileName: readTextColumn(row, 2, "file_name"),
    id: readTextColumn(row, 0, "id"),
    kind: readTextColumn(row, 4, "kind") === "media" ? "media" : "file",
    size: readCountColumn(row, 5, "size"),
    storageName: readTextColumn(row, 7, "storage_name"),
    uploadedBy: readTextColumn(row, 8, "uploaded_by"),
    uploadedByName: readNullableTextColumn(row, 9, "uploader_name"),
    workItemId: readTextColumn(row, 1, "work_item_id"),
  };
}

/** Owns the metadata of files attached to tickets; the files lie on disk. */
export class WorkItemAttachmentRepository {
  private readonly database: DatabaseTransaction;

  /**
   * Creates the repository.
   *
   * @param database - Central database access.
   */
  public constructor(database: DatabaseTransaction) {
    this.database = database;
  }

  /**
   * Stores the metadata of an attached file.
   *
   * @param attachment - What the server knows about the file.
   * @param id - Immutable attachment identifier, also used in the storage filename.
   * @param options - Direct uploads must still have an active ticket when metadata is inserted.
   * @returns The identifier and the creation time of the attachment.
   */
  public async insert(
    attachment: NewWorkItemAttachment,
    id: string = randomUUID(),
    options: { readonly requiresActiveTicket?: boolean } = {},
  ): Promise<{ readonly id: string; readonly createdAt: string }> {
    const [row] = await this.database.query(
      `
        INSERT INTO work_item_attachments (
            id,
            work_item_id,
            file_name,
            content_type,
            kind,
            size,
            checksum,
            storage_name,
            uploaded_by
        )
        SELECT
            $id,
            $work_item_id,
            $file_name,
            $content_type,
            $kind,
            $size,
            $checksum,
            $storage_name,
            $uploaded_by
        WHERE $requires_active_ticket = 0
            OR EXISTS (
                SELECT id
                FROM work_items
                WHERE id = $work_item_id
                    AND archived_at IS NULL
            )
        RETURNING created_at;
      `,
      {
        requires_active_ticket: options.requiresActiveTicket ? 1 : 0,
        checksum: attachment.checksum,
        content_type: attachment.contentType,
        file_name: attachment.fileName,
        id,
        kind: attachment.kind,
        size: attachment.size,
        storage_name: attachment.storageName,
        uploaded_by: attachment.uploadedBy,
        work_item_id: attachment.workItemId,
      },
    );

    if (!row) throw new WorkItemNotFoundError();
    return { createdAt: readTextColumn(row, 0, "created_at"), id };
  }

  /** Lists every attachment for the offline migration and the read-only inventory. */
  public async listAll(): Promise<StoredWorkItemAttachment[]> {
    const rows = await this.database.query(`
      SELECT ${COLUMNS}
      FROM work_item_attachments AS attachment
      LEFT JOIN users AS uploader
          ON uploader.id = attachment.uploaded_by
      ORDER BY attachment.id;
    `);
    return rows.map(readAttachment);
  }

  /** Updates only storage facts after the migration verified the unchanged bytes. */
  public async updateStorage(
    attachment: Pick<
      StoredWorkItemAttachment,
      "id" | "storageName" | "contentType" | "kind"
    >,
  ): Promise<void> {
    await this.database.execute(
      `
      UPDATE work_item_attachments
      SET storage_name = $storage_name,
          content_type = $content_type,
          kind = $kind
      WHERE id = $id;
    `,
      {
        id: attachment.id,
        storage_name: attachment.storageName,
        content_type: attachment.contentType,
        kind: attachment.kind,
      },
    );
  }

  /**
   * Lists the attachments of a ticket.
   *
   * @param workItemId - Ticket identifier.
   * @returns The attachments, oldest first.
   */
  public async listByWorkItem(
    workItemId: string,
  ): Promise<StoredWorkItemAttachment[]> {
    const rows = await this.database.query(
      `
        SELECT ${COLUMNS}
        FROM work_item_attachments AS attachment
        LEFT JOIN users AS uploader
            ON uploader.id = attachment.uploaded_by
        WHERE attachment.work_item_id = $work_item_id
        ORDER BY
            attachment.created_at,
            attachment.file_name,
            attachment.id;
      `,
      { work_item_id: workItemId },
    );

    return rows.map(readAttachment);
  }

  /**
   * Reads one attachment.
   *
   * @param id - Attachment identifier.
   * @returns The attachment, or `null`.
   */
  public async find(id: string): Promise<StoredWorkItemAttachment | null> {
    const [row] = await this.database.query(
      `
        SELECT ${COLUMNS}
        FROM work_item_attachments AS attachment
        LEFT JOIN users AS uploader
            ON uploader.id = attachment.uploaded_by
        WHERE attachment.id = $id;
      `,
      { id },
    );

    return row ? readAttachment(row) : null;
  }

  /**
   * Removes the metadata of an attachment.
   *
   * @param id - Attachment identifier.
   */
  public async delete(id: string): Promise<void> {
    await this.database.execute(
      "DELETE FROM work_item_attachments WHERE id = $id;",
      { id },
    );
  }

  /**
   * Lists the stored files of some tickets, for example before they are
   * deleted for good.
   *
   * @param workItemIds - Ticket identifiers.
   * @returns Storage names.
   */
  public async findStorageNames(
    workItemIds: readonly string[],
  ): Promise<string[]> {
    if (workItemIds.length === 0) {
      return [];
    }

    const { parameters, placeholders } = createInClause(
      "work_item_id",
      workItemIds,
    );
    const rows = await this.database.query(
      `
        SELECT storage_name
        FROM work_item_attachments
        WHERE work_item_id IN (${placeholders})
        ORDER BY storage_name;
      `,
      parameters,
    );

    return rows.map((row) => readTextColumn(row, 0, "storage_name"));
  }

  /**
   * Lists the names of every file the database refers to.
   *
   * @returns Storage names.
   */
  public async listStorageNames(): Promise<string[]> {
    const rows = await this.database.query(
      "SELECT storage_name FROM work_item_attachments;",
    );

    return rows.map((row) => readTextColumn(row, 0, "storage_name"));
  }
}
