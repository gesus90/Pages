import { createInClause } from "@/backend/database/repositories/task/InClause";
import {
  readCountColumn,
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";

import type {
  Database,
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";

const ATTACHMENT_COLUMNS = `
    conversation_attachments.id,
    conversation_attachments.conversation_id,
    conversation_attachments.message_id,
    conversation_attachments.uploader_id,
    conversation_attachments.name,
    conversation_attachments.mime_type,
    conversation_attachments.size_bytes,
    conversation_attachments.storage_name,
    conversation_attachments.position,
    conversation_attachments.thumbnail_storage_name,
    conversation_attachments.thumbnail_mime_type,
    conversation_attachments.thumbnail_size_bytes,
    conversation_attachments.created_at`;

/** The stored preview image of an attachment. */
export interface StoredConversationThumbnail {
  /** Name the file store gave the image; never leaves the server. */
  readonly storageName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
}

/** A stored attachment with what only the server knows of it. */
export interface StoredConversationAttachment {
  readonly id: string;
  readonly conversationId: string;
  /** `null` until the message it was uploaded for is sent. */
  readonly messageId: string | null;
  readonly uploaderId: string;
  readonly name: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  /** Name the file store gave the file; never leaves the server. */
  readonly storageName: string;
  readonly position: number;
  readonly thumbnail: StoredConversationThumbnail | null;
  readonly createdAt: string;
}

/** What a new attachment is stored with. */
export type NewConversationAttachment = Omit<
  StoredConversationAttachment,
  "thumbnail" | "position"
> & { readonly position?: number };

type AttachmentDatabase = Pick<Database, "query" | "execute" | "transaction">;

function readThumbnail(
  row: readonly DatabaseValue[],
): StoredConversationThumbnail | null {
  const storageName = readNullableTextColumn(row, 9, "thumbnail_storage_name");
  if (storageName === null) return null;
  return {
    storageName,
    mimeType: readTextColumn(row, 10, "thumbnail_mime_type"),
    sizeBytes: readCountColumn(row, 11, "thumbnail_size_bytes"),
  };
}

function toAttachment(
  row: readonly DatabaseValue[],
): StoredConversationAttachment {
  return {
    id: readTextColumn(row, 0, "id"),
    conversationId: readTextColumn(row, 1, "conversation_id"),
    messageId: readNullableTextColumn(row, 2, "message_id"),
    uploaderId: readTextColumn(row, 3, "uploader_id"),
    name: readTextColumn(row, 4, "name"),
    mimeType: readTextColumn(row, 5, "mime_type"),
    sizeBytes: readCountColumn(row, 6, "size_bytes"),
    storageName: readTextColumn(row, 7, "storage_name"),
    position: readCountColumn(row, 8, "position"),
    thumbnail: readThumbnail(row),
    createdAt: readTextColumn(row, 12, "created_at"),
  };
}

/** Binds uploaded attachments of the sender to a message, in the given order. */
async function bindAttachment(
  transaction: Pick<DatabaseTransaction, "query">,
  binding: {
    readonly attachmentId: string;
    readonly messageId: string;
    readonly conversationId: string;
    readonly uploaderId: string;
    readonly position: number;
  },
): Promise<boolean> {
  const rows = await transaction.query(
    `
      UPDATE conversation_attachments
      SET
          message_id = $message_id,
          position = $position
      WHERE id = $id
          AND conversation_id = $conversation_id
          AND uploader_id = $uploader_id
          AND message_id IS NULL
      RETURNING id;
    `,
    {
      id: binding.attachmentId,
      message_id: binding.messageId,
      conversation_id: binding.conversationId,
      uploader_id: binding.uploaderId,
      position: binding.position,
    },
  );
  return rows.length === 1;
}

/**
 * The attachments of conversation messages (PAGE-298).
 *
 * @remarks
 * A row names a file of the file store; the bytes never lie in the database.
 * An attachment is stored when its upload ended and bound to its message when
 * that is sent. Callers check membership before they read.
 */
export class ConversationAttachmentRepository {
  private readonly database: AttachmentDatabase;

  public constructor(database: AttachmentDatabase) {
    this.database = database;
  }

  /** Stores an uploaded attachment. */
  public async insert(attachment: NewConversationAttachment): Promise<void> {
    await this.database.execute(
      `
        INSERT INTO conversation_attachments (
            id,
            conversation_id,
            message_id,
            uploader_id,
            name,
            mime_type,
            size_bytes,
            storage_name,
            position,
            created_at
        )
        VALUES (
            $id,
            $conversation_id,
            $message_id,
            $uploader_id,
            $name,
            $mime_type,
            $size_bytes,
            $storage_name,
            $position,
            $created_at
        );
      `,
      {
        id: attachment.id,
        conversation_id: attachment.conversationId,
        message_id: attachment.messageId,
        uploader_id: attachment.uploaderId,
        name: attachment.name,
        mime_type: attachment.mimeType,
        size_bytes: attachment.sizeBytes,
        storage_name: attachment.storageName,
        position: attachment.position ?? 0,
        created_at: attachment.createdAt,
      },
    );
  }

  /** Returns an attachment by its ID, or `null`. */
  public async find(
    attachmentId: string,
  ): Promise<StoredConversationAttachment | null> {
    const rows = await this.database.query(
      `
        SELECT${ATTACHMENT_COLUMNS}
        FROM conversation_attachments
        WHERE id = $id;
      `,
      { id: attachmentId },
    );
    const [row] = rows;
    return row ? toAttachment(row) : null;
  }

  /** Returns the attachments of messages by message ID, each list in its order. */
  public async forMessages(
    messageIds: readonly string[],
  ): Promise<Map<string, StoredConversationAttachment[]>> {
    const byMessage = new Map<string, StoredConversationAttachment[]>();
    if (messageIds.length === 0) return byMessage;
    const list = createInClause("message", messageIds);
    const rows = await this.database.query(
      `
        SELECT${ATTACHMENT_COLUMNS}
        FROM conversation_attachments
        WHERE conversation_attachments.message_id IN (${list.placeholders})
        ORDER BY
            conversation_attachments.message_id,
            conversation_attachments.position,
            conversation_attachments.created_at;
      `,
      list.parameters,
    );
    for (const row of rows) {
      const attachment = toAttachment(row);
      if (attachment.messageId === null) continue;
      const known = byMessage.get(attachment.messageId) ?? [];
      known.push(attachment);
      byMessage.set(attachment.messageId, known);
    }
    return byMessage;
  }

  /**
   * Binds uploaded attachments to a message of their uploader.
   *
   * @param message - The message, its conversation and its sender.
   * @param attachmentIds - The attachments in their order.
   * @returns `false` when one of them is missing, belongs elsewhere or is
   * bound already; nothing is bound then.
   */
  public async bind(
    message: {
      readonly id: string;
      readonly conversationId: string;
      readonly senderId: string;
    },
    attachmentIds: readonly string[],
  ): Promise<boolean> {
    if (attachmentIds.length === 0) return true;
    try {
      await this.database.transaction(async (transaction) => {
        for (const [position, attachmentId] of attachmentIds.entries()) {
          const isBound = await bindAttachment(transaction, {
            attachmentId,
            messageId: message.id,
            conversationId: message.conversationId,
            uploaderId: message.senderId,
            position,
          });
          if (!isBound) throw new UnboundAttachmentError();
        }
      });
      return true;
    } catch (error: unknown) {
      if (error instanceof UnboundAttachmentError) return false;
      throw error;
    }
  }

  /**
   * Stores the preview image of an attachment that has none yet.
   *
   * @returns `false` when the attachment has a preview image already.
   */
  public async setThumbnail(
    attachmentId: string,
    thumbnail: StoredConversationThumbnail,
  ): Promise<boolean> {
    const rows = await this.database.query(
      `
        UPDATE conversation_attachments
        SET
            thumbnail_storage_name = $storage_name,
            thumbnail_mime_type = $mime_type,
            thumbnail_size_bytes = $size_bytes
        WHERE id = $id
            AND thumbnail_storage_name IS NULL
        RETURNING id;
      `,
      {
        id: attachmentId,
        storage_name: thumbnail.storageName,
        mime_type: thumbnail.mimeType,
        size_bytes: thumbnail.sizeBytes,
      },
    );
    return rows.length === 1;
  }

  /** Removes an attachment that is bound to no message; returns it, or `null`. */
  public async removeUnbound(
    attachmentId: string,
    uploaderId: string,
  ): Promise<StoredConversationAttachment | null> {
    const rows = await this.database.query(
      `
        DELETE FROM conversation_attachments
        WHERE id = $id
            AND uploader_id = $uploader_id
            AND message_id IS NULL
        RETURNING${ATTACHMENT_COLUMNS};
      `,
      { id: attachmentId, uploader_id: uploaderId },
    );
    const [row] = rows;
    return row ? toAttachment(row) : null;
  }

  /** Removes the attachments no message took since a moment; returns them. */
  public async removeUnboundBefore(
    createdBefore: string,
  ): Promise<StoredConversationAttachment[]> {
    const rows = await this.database.query(
      `
        DELETE FROM conversation_attachments
        WHERE message_id IS NULL
            AND created_at < $created_before
        RETURNING${ATTACHMENT_COLUMNS};
      `,
      { created_before: createdBefore },
    );
    return rows.map(toAttachment);
  }

  /** Returns every file name the attachments still list, for the sweep of the file store. */
  public async storageNames(): Promise<Set<string>> {
    const rows = await this.database.query(
      `
        SELECT
            storage_name,
            thumbnail_storage_name
        FROM conversation_attachments;
      `,
    );
    const names = new Set<string>();
    for (const row of rows) {
      names.add(readTextColumn(row, 0, "storage_name"));
      const thumbnail = readNullableTextColumn(
        row,
        1,
        "thumbnail_storage_name",
      );
      if (thumbnail !== null) names.add(thumbnail);
    }
    return names;
  }
}

/** Ends the transaction of a binding one attachment refuses. */
class UnboundAttachmentError extends Error {}
