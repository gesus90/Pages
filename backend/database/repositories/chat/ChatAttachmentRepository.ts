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
  /** The run of Pica that made a file of its answer; absent for an upload. */
  readonly runId?: string;
}

/** What a new attachment row records. */
export interface NewChatAttachment {
  readonly sessionId: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly size: number;
  readonly storageName: string;
}

/** A file of Pica's answer, kept with its run until the answer is stored. */
export interface NewChatAnswerFile extends NewChatAttachment {
  readonly runId: string;
}

/** What became of an upload: stored, refused because the message is full, or the session is gone. */
export type ChatUploadInsert =
  | { readonly kind: "stored"; readonly attachment: StoredChatAttachment }
  | { readonly kind: "full" }
  | { readonly kind: "sessionMissing" };

function readAttachment(row: readonly DatabaseValue[]): StoredChatAttachment {
  const runId = readNullableTextColumn(row, 8, "pica_run_id");
  return {
    id: readTextColumn(row, 0, "id"),
    sessionId: readTextColumn(row, 1, "session_id"),
    messageId: readNullableTextColumn(row, 2, "message_id"),
    fileName: readTextColumn(row, 3, "file_name"),
    contentType: readTextColumn(row, 4, "content_type"),
    size: readCountColumn(row, 5, "size"),
    storageName: readTextColumn(row, 6, "storage_name"),
    ...(readNullableTextColumn(row, 7, "origin") === "assistant"
      ? { origin: "assistant" as const }
      : {}),
    ...(runId === null ? {} : { runId }),
  };
}

const ATTACHMENT_COLUMNS = `
    chat_attachments.id,
    chat_attachments.session_id,
    chat_attachments.message_id,
    chat_attachments.file_name,
    chat_attachments.content_type,
    chat_attachments.size,
    chat_attachments.storage_name,
    chat_attachments.origin,
    chat_attachments.pica_run_id`;

const RETURNED_COLUMNS = `
    id,
    session_id,
    message_id,
    file_name,
    content_type,
    size,
    storage_name,
    origin,
    pica_run_id`;

/** Attachment rows; every lookup is bound to the owner of the session. */
export class ChatAttachmentRepository {
  private readonly database: Database;

  public constructor(database: Database) {
    this.database = database;
  }

  /**
   * Records an upload of the person at an own session; it stays unsent until a
   * message links it.
   *
   * @param userId - The owner the session must belong to.
   * @param attachment - The stored file and its row.
   * @param limit - Unsent uploads the session may hold at most; the count and
   * the insert are one statement, so concurrent uploads never exceed it.
   */
  public async insertUpload(
    userId: string,
    attachment: NewChatAttachment,
    limit: number,
  ): Promise<ChatUploadInsert> {
    const rows = await this.database.query(
      `
      INSERT INTO chat_attachments (
          id,
          session_id,
          file_name,
          content_type,
          size,
          storage_name,
          origin
      )
      SELECT
          $id,
          id,
          $file_name,
          $content_type,
          $size,
          $storage_name,
          'user'
      FROM chat_sessions
      WHERE id = $session_id
          AND user_id = $user_id
          AND (
              SELECT count(*)
              FROM chat_attachments
              WHERE chat_attachments.session_id = $session_id
                  AND chat_attachments.message_id IS NULL
                  AND chat_attachments.origin = 'user'
          ) < $limit
      RETURNING ${RETURNED_COLUMNS};
    `,
      {
        id: randomUUID(),
        session_id: attachment.sessionId,
        user_id: userId,
        file_name: attachment.fileName,
        content_type: attachment.contentType,
        size: attachment.size,
        storage_name: attachment.storageName,
        limit,
      },
    );
    if (rows.length > 0)
      return { kind: "stored", attachment: readAttachment(rows[0]) };
    const owned = await this.database.query(
      "SELECT id FROM chat_sessions WHERE id = $session_id AND user_id = $user_id;",
      { session_id: attachment.sessionId, user_id: userId },
    );
    return owned.length === 0 ? { kind: "sessionMissing" } : { kind: "full" };
  }

  /**
   * Records a file of Pica's answer at an own session, unlinked and invisible
   * until the answer of its run is stored.
   */
  public async insertAnswerFile(
    userId: string,
    file: NewChatAnswerFile,
  ): Promise<StoredChatAttachment | null> {
    const rows = await this.database.query(
      `
      INSERT INTO chat_attachments (
          id,
          session_id,
          file_name,
          content_type,
          size,
          storage_name,
          origin,
          pica_run_id
      )
      SELECT
          $id,
          id,
          $file_name,
          $content_type,
          $size,
          $storage_name,
          'assistant',
          $pica_run_id
      FROM chat_sessions
      WHERE id = $session_id
          AND user_id = $user_id
      RETURNING ${RETURNED_COLUMNS};
    `,
      {
        id: randomUUID(),
        session_id: file.sessionId,
        user_id: userId,
        file_name: file.fileName,
        content_type: file.contentType,
        size: file.size,
        storage_name: file.storageName,
        pica_run_id: file.runId,
      },
    );
    return rows.length === 0 ? null : readAttachment(rows[0]);
  }

  /** Lists the files a run of Pica made that no answer holds yet. */
  public async answerFiles(
    sessionId: string,
    runId: string,
  ): Promise<StoredChatAttachment[]> {
    const rows = await this.database.query(
      `
      SELECT ${ATTACHMENT_COLUMNS}
      FROM chat_attachments
      WHERE chat_attachments.session_id = $session_id
          AND chat_attachments.pica_run_id = $pica_run_id
          AND chat_attachments.origin = 'assistant'
          AND chat_attachments.message_id IS NULL
      ORDER BY chat_attachments.created_at, chat_attachments.id;
    `,
      { session_id: sessionId, pica_run_id: runId },
    );
    return rows.map(readAttachment);
  }

  /** Links every file a run made so far to the answer it belongs to. */
  public async claimAnswerFiles(
    sessionId: string,
    runId: string,
    messageId: string,
  ): Promise<StoredChatAttachment[]> {
    const rows = await this.database.query(
      `
      UPDATE chat_attachments
      SET message_id = $message_id
      WHERE session_id = $session_id
          AND pica_run_id = $pica_run_id
          AND origin = 'assistant'
          AND message_id IS NULL
      RETURNING ${RETURNED_COLUMNS};
    `,
      { session_id: sessionId, pica_run_id: runId, message_id: messageId },
    );
    return rows
      .map(readAttachment)
      .sort((left, right) => left.fileName.localeCompare(right.fileName));
  }

  /**
   * Removes the files a run made that no answer holds, after the run ended
   * without one, or every such file when `runId` is `null`.
   *
   * @returns Their storage names.
   */
  public async removeUnclaimedAnswerFiles(
    sessionId: string | null,
    runId: string | null,
  ): Promise<string[]> {
    const rows = await this.database.query(
      `
      DELETE FROM chat_attachments
      WHERE origin = 'assistant'
          AND message_id IS NULL
          AND ($session_id IS NULL OR session_id = $session_id)
          AND ($pica_run_id IS NULL OR pica_run_id = $pica_run_id)
      RETURNING storage_name;
    `,
      { session_id: sessionId, pica_run_id: runId },
    );
    return rows.map((row) => readTextColumn(row, 0, "storage_name"));
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

  /** Links unsent uploads to the message they were sent with. */
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
            AND message_id IS NULL
            AND origin = 'user';
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
          AND origin = 'user'
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
