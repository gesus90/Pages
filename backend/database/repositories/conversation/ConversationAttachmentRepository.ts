import { createInClause } from "@/backend/database/repositories/task/InClause";
import {
  readCountColumn,
  readNullableCountColumn,
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";

import type {
  Database,
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";

/** The columns of an attachment row, in the order {@link toAttachment} reads them (PAGE-386 reads them too). */
export const ATTACHMENT_COLUMNS = `
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
    conversation_attachments.created_at,
    conversation_attachments.expires_at,
    conversation_attachments.expired_at,
    conversation_attachments.media_width,
    conversation_attachments.media_height,
    conversation_attachments.media_duration_ms,
    conversation_attachments.sha256,
    conversation_attachments.document_pages,
    conversation_attachments.document_title`;

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
  /**
   * When an attachment of an agent's answer is removed (PAGE-382); `null` or
   * absent for an upload of a person, which stays.
   */
  readonly expiresAt?: string | null;
  /** When the file and its preview image were removed; the row stays as a placeholder. */
  readonly expiredAt?: string | null;
  /** Resolution and length of a video or a sound as the browser read them (PAGE-384); `null` until then. */
  readonly media?: StoredConversationMediaFacts | null;
  /** SHA-256 of the file in hex, computed while it was stored (PAGE-385); `null` for older files. */
  readonly sha256?: string | null;
  /** Page count and title of a PDF as the browser read them (PAGE-385); `null` until then. */
  readonly document?: StoredConversationDocumentFacts | null;
}

/** Page count and title of a document (PAGE-385). */
export interface StoredConversationDocumentFacts {
  readonly pageCount: number | null;
  /** The title from the metadata; `null` when the document names none. */
  readonly title: string | null;
}

/** Resolution and length of a video or a sound (PAGE-384). */
export interface StoredConversationMediaFacts {
  /** Pixels; `null` for a sound. */
  readonly width: number | null;
  readonly height: number | null;
  readonly durationMs: number | null;
}

/** An image or a video of a conversation with the message that carries it (PAGE-382, PAGE-384). */
export type StoredConversationMedia = StoredConversationImage;

/** An image of a conversation with the message that carries it (PAGE-382). */
export interface StoredConversationImage {
  readonly attachment: StoredConversationAttachment;
  readonly messageId: string;
  readonly senderId: string;
  /** When the message was sent. */
  readonly sentAt: string;
}

/** What a new attachment is stored with. */
export type NewConversationAttachment = Omit<
  StoredConversationAttachment,
  "thumbnail" | "position" | "expiredAt" | "media" | "document"
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

/**
 * Reads the first 21 columns of a row selected with {@link ATTACHMENT_COLUMNS}.
 *
 * @param row - The row of the query.
 * @returns The stored attachment.
 */
export function toAttachment(
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
    expiresAt: readNullableTextColumn(row, 13, "expires_at"),
    expiredAt: readNullableTextColumn(row, 14, "expired_at"),
    media: readMediaFacts(row),
    sha256: readNullableTextColumn(row, 18, "sha256"),
    document: readDocumentFacts(row),
  };
}

function readDocumentFacts(
  row: readonly DatabaseValue[],
): StoredConversationDocumentFacts | null {
  const pageCount = readNullableCountColumn(row, 19, "document_pages");
  const title = readNullableTextColumn(row, 20, "document_title");
  if (pageCount === null && title === null) return null;
  return { pageCount, title };
}

function readMediaFacts(
  row: readonly DatabaseValue[],
): StoredConversationMediaFacts | null {
  const width = readNullableCountColumn(row, 15, "media_width");
  const height = readNullableCountColumn(row, 16, "media_height");
  const durationMs = readNullableCountColumn(row, 17, "media_duration_ms");
  if (width === null && height === null && durationMs === null) return null;
  return { width, height, durationMs };
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
            created_at,
            expires_at,
            sha256
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
            $created_at,
            $expires_at,
            $sha256
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
        expires_at: attachment.expiresAt ?? null,
        sha256: attachment.sha256 ?? null,
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

  /** Returns every attachment of a conversation, bound or not, for a dissolved group (PAGE-380). */
  public async forConversation(
    conversationId: string,
  ): Promise<StoredConversationAttachment[]> {
    const rows = await this.database.query(
      `
        SELECT${ATTACHMENT_COLUMNS}
        FROM conversation_attachments
        WHERE conversation_attachments.conversation_id = $conversation_id;
      `,
      { conversation_id: conversationId },
    );
    return rows.map(toAttachment);
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

  /**
   * Marks every attachment whose time ran out by a moment as expired and
   * drops its preview image (PAGE-382).
   *
   * @param dueBefore - Attachments with `expires_at` up to this moment expire.
   * @param expiredAt - The moment stored as `expired_at`.
   * @returns The file names the expired attachments listed before, for their
   * removal; the rows stay as placeholders.
   */
  public async expireDue(
    dueBefore: string,
    expiredAt: string,
  ): Promise<string[]> {
    const rows = await this.database.query(
      `
        WITH due AS (
            SELECT
                id,
                storage_name,
                thumbnail_storage_name
            FROM conversation_attachments
            WHERE expires_at IS NOT NULL
                AND expires_at <= $due_before
                AND expired_at IS NULL
            FOR UPDATE
        )
        UPDATE conversation_attachments
        SET
            expired_at = $expired_at,
            thumbnail_storage_name = NULL,
            thumbnail_mime_type = NULL,
            thumbnail_size_bytes = NULL
        FROM due
        WHERE conversation_attachments.id = due.id
        RETURNING
            due.storage_name,
            due.thumbnail_storage_name;
      `,
      { due_before: dueBefore, expired_at: expiredAt },
    );
    const names: string[] = [];
    for (const row of rows) {
      names.push(readTextColumn(row, 0, "storage_name"));
      const thumbnail = readNullableTextColumn(
        row,
        1,
        "thumbnail_storage_name",
      );
      if (thumbnail !== null) names.push(thumbnail);
    }
    return names;
  }

  /**
   * Stores the resolution and the length of a video or a sound once
   * (PAGE-384); facts already stored stay.
   *
   * @returns `false` when the attachment has facts already or is missing.
   */
  public async setMediaFacts(
    attachmentId: string,
    facts: StoredConversationMediaFacts,
  ): Promise<boolean> {
    const rows = await this.database.query(
      `
        UPDATE conversation_attachments
        SET
            media_width = $width,
            media_height = $height,
            media_duration_ms = $duration_ms
        WHERE id = $id
            AND media_width IS NULL
            AND media_height IS NULL
            AND media_duration_ms IS NULL
        RETURNING id;
      `,
      {
        id: attachmentId,
        width: facts.width,
        height: facts.height,
        duration_ms: facts.durationMs,
      },
    );
    return rows.length === 1;
  }

  /**
   * Stores page count and title of a document that has none yet (PAGE-385).
   *
   * @returns `false` when the attachment has them already.
   */
  public async setDocumentFacts(
    attachmentId: string,
    facts: StoredConversationDocumentFacts,
  ): Promise<boolean> {
    const rows = await this.database.query(
      `
        UPDATE conversation_attachments
        SET
            document_pages = $page_count,
            document_title = $title
        WHERE id = $id
            AND document_pages IS NULL
            AND document_title IS NULL
        RETURNING id;
      `,
      {
        id: attachmentId,
        page_count: facts.pageCount,
        title: facts.title,
      },
    );
    return rows.length === 1;
  }

  /**
   * Returns the images of the sent messages of a conversation, oldest
   * message first and in their order within a message (PAGE-382).
   */
  public async imagesOfConversation(
    conversationId: string,
  ): Promise<StoredConversationImage[]> {
    return this.mediaOfConversation(conversationId, "image");
  }

  /**
   * Returns the images or the videos of the sent messages of a conversation,
   * oldest message first and in their order within a message (PAGE-382,
   * PAGE-384).
   */
  public async mediaOfConversation(
    conversationId: string,
    kind: "image" | "video",
  ): Promise<StoredConversationMedia[]> {
    const rows = await this.database.query(
      `
        SELECT${ATTACHMENT_COLUMNS},
            conversation_messages.sender_id,
            conversation_messages.created_at AS sent_at
        FROM conversation_attachments
        INNER JOIN conversation_messages
            ON conversation_messages.id = conversation_attachments.message_id
        WHERE conversation_attachments.conversation_id = $conversation_id
            AND conversation_attachments.mime_type LIKE $type_pattern
        ORDER BY
            conversation_messages.sequence,
            conversation_attachments.position;
      `,
      {
        conversation_id: conversationId,
        type_pattern: kind === "video" ? "video/%" : "image/%",
      },
    );
    const images: StoredConversationImage[] = [];
    for (const row of rows) {
      const attachment = toAttachment(row);
      if (attachment.messageId === null) continue;
      images.push({
        attachment,
        messageId: attachment.messageId,
        senderId: readTextColumn(row, 21, "sender_id"),
        sentAt: readTextColumn(row, 22, "sent_at"),
      });
    }
    return images;
  }

  /** Returns every file name the attachments still list, for the sweep of the file store. */
  public async storageNames(): Promise<Set<string>> {
    const rows = await this.database.query(
      `
        SELECT
            storage_name,
            thumbnail_storage_name
        FROM conversation_attachments
        WHERE expired_at IS NULL;
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
