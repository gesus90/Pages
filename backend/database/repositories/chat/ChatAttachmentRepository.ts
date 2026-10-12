import { randomUUID } from "node:crypto";

import {
  readCountColumn,
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";

import type { Database, DatabaseValue } from "@/backend/database/Database";
import type { ChatAttachment } from "@/definition/Chat";

/** A stored attachment with the file it lives in. */
export interface StoredChatAttachment extends ChatAttachment {
  readonly sessionId: string;
  readonly messageId: string | null;
  readonly storageName: string;
}

/** What a new attachment row records. */
export interface NewChatAttachment {
  readonly sessionId: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly size: number;
  readonly storageName: string;
}

function readAttachment(row: readonly DatabaseValue[]): StoredChatAttachment {
  return {
    id: readTextColumn(row, 0, "id"),
    sessionId: readTextColumn(row, 1, "session_id"),
    messageId: readNullableTextColumn(row, 2, "message_id"),
    fileName: readTextColumn(row, 3, "file_name"),
    contentType: readTextColumn(row, 4, "content_type"),
    size: readCountColumn(row, 5, "size"),
    storageName: readTextColumn(row, 6, "storage_name"),
  };
}

const ATTACHMENT_COLUMNS = `
    chat_attachments.id,
    chat_attachments.session_id,
    chat_attachments.message_id,
    chat_attachments.file_name,
    chat_attachments.content_type,
    chat_attachments.size,
    chat_attachments.storage_name`;

/** Attachment rows; every lookup is bound to the owner of the session. */
export class ChatAttachmentRepository {
  private readonly database: Database;

  public constructor(database: Database) {
    this.database = database;
  }

  /** Records a stored file at an own session; it stays unsent until a message links it. */
  public async insert(
    userId: string,
    attachment: NewChatAttachment,
  ): Promise<StoredChatAttachment | null> {
    const rows = await this.database.query(
      `
      INSERT INTO chat_attachments (
          id,
          session_id,
          file_name,
          content_type,
          size,
          storage_name
      )
      SELECT
          $id,
          id,
          $file_name,
          $content_type,
          $size,
          $storage_name
      FROM chat_sessions
      WHERE id = $session_id
          AND user_id = $user_id
      RETURNING
          id,
          session_id,
          message_id,
          file_name,
          content_type,
          size,
          storage_name;
    `,
      {
        id: randomUUID(),
        session_id: attachment.sessionId,
        user_id: userId,
        file_name: attachment.fileName,
        content_type: attachment.contentType,
        size: attachment.size,
        storage_name: attachment.storageName,
      },
    );
    return rows.length === 0 ? null : readAttachment(rows[0]);
  }

  /** Returns an attachment of an own session; foreign and unknown IDs yield `null` alike. */
  public async find(
    userId: string,
    id: string,
  ): Promise<StoredChatAttachment | null> {
    const rows = await this.database.query(
      `
      SELECT ${ATTACHMENT_COLUMNS}
      FROM chat_attachments
      INNER JOIN chat_sessions
          ON chat_sessions.id = chat_attachments.session_id
      WHERE chat_attachments.id = $id
          AND chat_sessions.user_id = $user_id;
    `,
      { id, user_id: userId },
    );
    return rows.length === 0 ? null : readAttachment(rows[0]);
  }

  /** Lists every attachment of a session whose ownership was checked. */
  public async list(sessionId: string): Promise<StoredChatAttachment[]> {
    const rows = await this.database.query(
      `
      SELECT ${ATTACHMENT_COLUMNS}
      FROM chat_attachments
      WHERE chat_attachments.session_id = $session_id
      ORDER BY chat_attachments.created_at, chat_attachments.id;
    `,
      { session_id: sessionId },
    );
    return rows.map(readAttachment);
  }

  /** Links unsent attachments to the message they were sent with. */
  public async link(
    sessionId: string,
    messageId: string,
    ids: readonly string[],
  ): Promise<void> {
    for (const id of ids)
      await this.database.execute(
        `
        UPDATE chat_attachments
        SET message_id = $message_id
        WHERE id = $id
            AND session_id = $session_id
            AND message_id IS NULL;
      `,
        { id, session_id: sessionId, message_id: messageId },
      );
  }

  /** Removes an unsent attachment of an own session and returns its file. */
  public async removeUnsent(
    userId: string,
    id: string,
  ): Promise<string | null> {
    const rows = await this.database.query(
      `
      DELETE FROM chat_attachments
      WHERE id = $id
          AND message_id IS NULL
          AND session_id IN (
              SELECT id
              FROM chat_sessions
              WHERE user_id = $user_id
          )
      RETURNING storage_name;
    `,
      { id, user_id: userId },
    );
    return rows.length === 0
      ? null
      : readTextColumn(rows[0], 0, "storage_name");
  }
}
