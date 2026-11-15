import { createInClause } from "@/backend/database/repositories/task/InClause";
import {
  readCountColumn,
  readNullableCountColumn,
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";

import {
  ATTACHMENT_COLUMNS,
  toAttachment,
} from "./ConversationAttachmentRepository";

import type { Database, DatabaseValue } from "@/backend/database/Database";
import type { StoredConversationAttachment } from "./ConversationAttachmentRepository";

/** Columns of an attachment row: the next column after them has this index. */
const ATTACHMENT_COLUMN_COUNT = 21;

/** An attachment of a sent message with the facts of that message (PAGE-386). */
export interface StoredLibraryAttachment {
  readonly attachment: StoredConversationAttachment;
  readonly messageId: string;
  readonly senderId: string;
  readonly sequence: number;
  /** When the message was sent. */
  readonly sentAt: string;
  /** Whether Pages stored the recognized text of the attachment already. */
  readonly hasText: boolean;
}

/** A voice message of a conversation (PAGE-386). */
export interface StoredLibraryVoice {
  readonly messageId: string;
  readonly senderId: string;
  readonly sequence: number;
  readonly sentAt: string;
  /** The recognized text; empty until or without one. */
  readonly text: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly durationMs: number;
  readonly transcriptionState: string;
}

/** A line of an answer that shows an earlier attachment again, as stored (PAGE-386). */
export interface StoredAttachmentReference {
  readonly messageId: string;
  readonly position: number;
  readonly conversationId: string;
  readonly attachmentId: string;
  readonly name: string;
  readonly mimeType: string;
  readonly sourceMessageId: string;
  readonly sourceSenderId: string;
  readonly createdAt: string;
}

const REFERENCE_COLUMNS = `
    conversation_attachment_references.message_id,
    conversation_attachment_references.position,
    conversation_attachment_references.conversation_id,
    conversation_attachment_references.attachment_id,
    conversation_attachment_references.name,
    conversation_attachment_references.mime_type,
    conversation_attachment_references.source_message_id,
    conversation_attachment_references.source_sender_id,
    conversation_attachment_references.created_at`;

type LibraryDatabase = Pick<Database, "query" | "execute">;

function toLibraryAttachment(
  row: readonly DatabaseValue[],
): StoredLibraryAttachment {
  const at = ATTACHMENT_COLUMN_COUNT;
  return {
    attachment: toAttachment(row),
    messageId: readTextColumn(row, at, "message_id"),
    senderId: readTextColumn(row, at + 1, "sender_id"),
    sequence: readCountColumn(row, at + 2, "sequence"),
    sentAt: readTextColumn(row, at + 3, "sent_at"),
    hasText: readNullableTextColumn(row, at + 4, "text_created_at") !== null,
  };
}

function toVoice(row: readonly DatabaseValue[]): StoredLibraryVoice {
  return {
    messageId: readTextColumn(row, 0, "id"),
    senderId: readTextColumn(row, 1, "sender_id"),
    sequence: readCountColumn(row, 2, "sequence"),
    sentAt: readTextColumn(row, 3, "created_at"),
    text: readTextColumn(row, 4, "text"),
    mimeType: readTextColumn(row, 5, "voice_mime_type"),
    sizeBytes: readCountColumn(row, 6, "voice_size_bytes"),
    durationMs: readNullableCountColumn(row, 7, "voice_duration_ms") ?? 0,
    transcriptionState: readTextColumn(row, 8, "transcription_state"),
  };
}

function toReference(row: readonly DatabaseValue[]): StoredAttachmentReference {
  return {
    messageId: readTextColumn(row, 0, "message_id"),
    position: readCountColumn(row, 1, "position"),
    conversationId: readTextColumn(row, 2, "conversation_id"),
    attachmentId: readTextColumn(row, 3, "attachment_id"),
    name: readTextColumn(row, 4, "name"),
    mimeType: readTextColumn(row, 5, "mime_type"),
    sourceMessageId: readTextColumn(row, 6, "source_message_id"),
    sourceSenderId: readTextColumn(row, 7, "source_sender_id"),
    createdAt: readTextColumn(row, 8, "created_at"),
  };
}

const LIBRARY_SELECT = `
    SELECT${ATTACHMENT_COLUMNS},
        conversation_messages.id AS message_id,
        conversation_messages.sender_id,
        conversation_messages.sequence,
        conversation_messages.created_at AS sent_at,
        conversation_attachment_texts.created_at AS text_created_at
    FROM conversation_attachments
    INNER JOIN conversation_messages
        ON conversation_messages.id = conversation_attachments.message_id
    LEFT JOIN conversation_attachment_texts
        ON conversation_attachment_texts.attachment_id = conversation_attachments.id`;

/**
 * The attachments of a chat as its agents search and read them, the text
 * Pages recognized in them, and the references of answers (PAGE-386).
 *
 * @remarks
 * Only attachments of sent messages are listed: an upload without a message
 * is its uploader's alone. Callers check that the reader is a member of the
 * conversation now.
 */
export class ConversationAttachmentLibraryRepository {
  private readonly database: LibraryDatabase;

  public constructor(database: LibraryDatabase) {
    this.database = database;
  }

  /** Returns the attachments of the sent messages of a conversation, newest message first. */
  public async attachments(
    conversationId: string,
  ): Promise<StoredLibraryAttachment[]> {
    const rows = await this.database.query(
      `${LIBRARY_SELECT}
        WHERE conversation_attachments.conversation_id = $conversation_id
        ORDER BY
            conversation_messages.sequence DESC,
            conversation_attachments.position;
      `,
      { conversation_id: conversationId },
    );
    return rows.map(toLibraryAttachment);
  }

  /** Returns one attachment of a sent message of a conversation, or `null`. */
  public async attachment(
    conversationId: string,
    attachmentId: string,
  ): Promise<StoredLibraryAttachment | null> {
    const rows = await this.database.query(
      `${LIBRARY_SELECT}
        WHERE conversation_attachments.conversation_id = $conversation_id
            AND conversation_attachments.id = $id;
      `,
      { conversation_id: conversationId, id: attachmentId },
    );
    const [row] = rows;
    return row ? toLibraryAttachment(row) : null;
  }

  /** Returns the voice messages of a conversation, newest first. */
  public async voices(conversationId: string): Promise<StoredLibraryVoice[]> {
    const rows = await this.database.query(
      `
        SELECT
            id,
            sender_id,
            sequence,
            created_at,
            text,
            voice_mime_type,
            voice_size_bytes,
            voice_duration_ms,
            transcription_state
        FROM conversation_messages
        WHERE conversation_id = $conversation_id
            AND voice_storage_name IS NOT NULL
        ORDER BY sequence DESC;
      `,
      { conversation_id: conversationId },
    );
    return rows.map(toVoice);
  }

  /** Returns the stored recognized texts of attachments by attachment ID. */
  public async texts(
    attachmentIds: readonly string[],
  ): Promise<Map<string, string>> {
    const texts = new Map<string, string>();
    if (attachmentIds.length === 0) return texts;
    const list = createInClause("attachment", attachmentIds);
    const rows = await this.database.query(
      `
        SELECT
            attachment_id,
            content
        FROM conversation_attachment_texts
        WHERE attachment_id IN (${list.placeholders});
      `,
      list.parameters,
    );
    for (const row of rows)
      texts.set(
        readTextColumn(row, 0, "attachment_id"),
        readTextColumn(row, 1, "content"),
      );
    return texts;
  }

  /** Stores the recognized text of an attachment; a stored one is replaced. */
  public async saveText(
    attachmentId: string,
    content: string,
    createdAt: string,
  ): Promise<void> {
    await this.database.execute(
      `
        INSERT INTO conversation_attachment_texts (
            attachment_id,
            content,
            created_at
        )
        VALUES (
            $attachment_id,
            $content,
            $created_at
        )
        ON CONFLICT (attachment_id) DO UPDATE
        SET
            content = EXCLUDED.content,
            created_at = EXCLUDED.created_at;
      `,
      { attachment_id: attachmentId, content, created_at: createdAt },
    );
  }

  /** Stores the references of one answer, in their order. */
  public async insertReferences(
    references: readonly StoredAttachmentReference[],
  ): Promise<void> {
    for (const reference of references)
      await this.database.execute(
        `
          INSERT INTO conversation_attachment_references (
              message_id,
              position,
              conversation_id,
              attachment_id,
              name,
              mime_type,
              source_message_id,
              source_sender_id,
              created_at
          )
          VALUES (
              $message_id,
              $position,
              $conversation_id,
              $attachment_id,
              $name,
              $mime_type,
              $source_message_id,
              $source_sender_id,
              $created_at
          )
          ON CONFLICT (message_id, position) DO NOTHING;
        `,
        {
          message_id: reference.messageId,
          position: reference.position,
          conversation_id: reference.conversationId,
          attachment_id: reference.attachmentId,
          name: reference.name,
          mime_type: reference.mimeType,
          source_message_id: reference.sourceMessageId,
          source_sender_id: reference.sourceSenderId,
          created_at: reference.createdAt,
        },
      );
  }

  /** Returns the references of messages by message ID, each list in its order. */
  public async referencesForMessages(
    messageIds: readonly string[],
  ): Promise<Map<string, StoredAttachmentReference[]>> {
    const byMessage = new Map<string, StoredAttachmentReference[]>();
    if (messageIds.length === 0) return byMessage;
    const list = createInClause("message", messageIds);
    const rows = await this.database.query(
      `
        SELECT${REFERENCE_COLUMNS}
        FROM conversation_attachment_references
        WHERE conversation_attachment_references.message_id IN (${list.placeholders})
        ORDER BY
            conversation_attachment_references.message_id,
            conversation_attachment_references.position;
      `,
      list.parameters,
    );
    for (const row of rows) {
      const reference = toReference(row);
      const known = byMessage.get(reference.messageId) ?? [];
      known.push(reference);
      byMessage.set(reference.messageId, known);
    }
    return byMessage;
  }

  /** Returns the attachments of IDs that still exist, by ID. */
  public async findMany(
    attachmentIds: readonly string[],
  ): Promise<Map<string, StoredLibraryAttachment>> {
    const found = new Map<string, StoredLibraryAttachment>();
    if (attachmentIds.length === 0) return found;
    const list = createInClause("attachment", attachmentIds);
    const rows = await this.database.query(
      `${LIBRARY_SELECT}
        WHERE conversation_attachments.id IN (${list.placeholders});
      `,
      list.parameters,
    );
    for (const row of rows) {
      const entry = toLibraryAttachment(row);
      found.set(entry.attachment.id, entry);
    }
    return found;
  }
}
