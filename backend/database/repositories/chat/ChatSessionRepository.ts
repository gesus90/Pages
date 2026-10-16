import { randomUUID } from "node:crypto";

import {
  readNullableBooleanColumn,
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";
import { ChatError } from "@/backend/error/ChatErrors";

import type {
  Database,
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";
import type { ChatMessage, ChatSession } from "@/definition/Chat";

/** Characters of the first message shown to recognize a session. */
const PREVIEW_CHARACTERS = 80;

/** A message as stored; attachments are read separately. */
export type StoredChatMessage = Omit<ChatMessage, "attachments">;

/** A message to store. */
export interface NewChatMessage extends Pick<
  ChatMessage,
  "role" | "content" | "isStopped"
> {
  /**
   * The ID the browser gave a message the person sent; a second message with
   * the same ID in the conversation is refused (PAGE-68).
   */
  readonly clientMessageId?: string | null;
}

function readSession(row: readonly DatabaseValue[]): ChatSession {
  const preview = readNullableTextColumn(row, 3, "preview") ?? "";
  return {
    id: readTextColumn(row, 0, "id"),
    createdAt: readTextColumn(row, 1, "created_at"),
    lastMessageAt: readTextColumn(row, 2, "last_message_at"),
    preview: preview.replace(/\s+/gu, " ").trim(),
  };
}

function readMessage(row: readonly DatabaseValue[]): StoredChatMessage {
  const role = readTextColumn(row, 1, "role");
  if (role !== "user" && role !== "assistant")
    throw new Error(`Database returned an unsupported chat role "${role}".`);
  return {
    id: readTextColumn(row, 0, "id"),
    role,
    content: readTextColumn(row, 2, "content"),
    createdAt: readTextColumn(row, 3, "created_at"),
    ...(readNullableBooleanColumn(row, 4, "is_stopped") === true
      ? { isStopped: true }
      : {}),
  };
}

const SESSION_COLUMNS = `
    chat_sessions.id,
    chat_sessions.created_at,
    chat_sessions.last_message_at,
    (
        SELECT left(chat_messages.content, ${PREVIEW_CHARACTERS})
        FROM chat_messages
        WHERE chat_messages.session_id = chat_sessions.id
            AND chat_messages.role = 'user'
        ORDER BY chat_messages.position
        LIMIT 1
    ) AS preview`;

/** Removes the Pica jobs of a session with their journal, steers, selections and agent session. */
async function removeAcpJobs(
  transaction: DatabaseTransaction,
  sessionId: string,
): Promise<void> {
  const parameters = { session_id: sessionId };
  await transaction.execute(
    `
    DELETE FROM chat_job_events
    WHERE job_id IN (
        SELECT id
        FROM chat_jobs
        WHERE session_id = $session_id
    );
  `,
    parameters,
  );
  await transaction.execute(
    `
    DELETE FROM chat_job_turns
    WHERE job_id IN (
        SELECT id
        FROM chat_jobs
        WHERE session_id = $session_id
    );
  `,
    parameters,
  );
  for (const table of ["chat_jobs", "chat_steers", "chat_selections"] as const)
    await transaction.execute(
      `DELETE FROM ${table} WHERE session_id = $session_id;`,
      parameters,
    );
  await transaction.execute(
    "DELETE FROM chat_acp_sessions WHERE chat_session_id = $session_id;",
    parameters,
  );
}

/** Every session query is bound to its owner; administrators have no other read path. */
export class ChatSessionRepository {
  private readonly database: Pick<
    Database,
    "query" | "execute" | "transaction"
  >;

  public constructor(
    database: Pick<Database, "query" | "execute" | "transaction">,
  ) {
    this.database = database;
  }

  /** Tells whether any person already uses the ID, so new IDs stay globally unique. */
  public async exists(id: string): Promise<boolean> {
    const rows = await this.database.query(
      "SELECT id FROM chat_sessions WHERE id = $id;",
      { id },
    );
    return rows.length > 0;
  }

  /** Creates an empty session of the person. */
  public async create(userId: string, id: string): Promise<void> {
    await this.database.execute(
      `
      INSERT INTO chat_sessions (
          id,
          user_id
      )
      VALUES (
          $id,
          $user_id
      );
    `,
      { id, user_id: userId },
    );
  }

  /** Lists the person's own sessions, most recently used first. */
  public async list(userId: string, limit?: number): Promise<ChatSession[]> {
    const rows = await this.database.query(
      `
      SELECT ${SESSION_COLUMNS}
      FROM chat_sessions
      WHERE chat_sessions.user_id = $user_id
      ORDER BY chat_sessions.last_message_at DESC, chat_sessions.created_at DESC, chat_sessions.id
      ${limit === undefined ? "" : "LIMIT $limit"};
    `,
      limit === undefined ? { user_id: userId } : { user_id: userId, limit },
    );
    return rows.map(readSession);
  }

  /** Returns an own session; a foreign or unknown ID yields `null` alike. */
  public async find(userId: string, id: string): Promise<ChatSession | null> {
    const rows = await this.database.query(
      `
      SELECT ${SESSION_COLUMNS}
      FROM chat_sessions
      WHERE chat_sessions.id = $id
          AND chat_sessions.user_id = $user_id;
    `,
      { id, user_id: userId },
    );
    return rows.length === 0 ? null : readSession(rows[0]);
  }

  /** Returns the messages of a session in display order, after ownership was checked. */
  public async messages(sessionId: string): Promise<StoredChatMessage[]> {
    const rows = await this.database.query(
      `
      SELECT
          id,
          role,
          content,
          created_at,
          is_stopped
      FROM chat_messages
      WHERE session_id = $session_id
      ORDER BY position;
    `,
      { session_id: sessionId },
    );
    return rows.map(readMessage);
  }

  /**
   * Returns the message the browser gave this ID in a session, after ownership was checked.
   *
   * @returns The message, or `null` when none of the session carries the ID.
   */
  public async findByClientId(
    sessionId: string,
    clientMessageId: string,
  ): Promise<StoredChatMessage | null> {
    const rows = await this.database.query(
      `
      SELECT
          id,
          role,
          content,
          created_at,
          is_stopped
      FROM chat_messages
      WHERE session_id = $session_id
          AND client_message_id = $client_message_id;
    `,
      { session_id: sessionId, client_message_id: clientMessageId },
    );
    return rows.length === 0 ? null : readMessage(rows[0]);
  }

  /**
   * Appends a message to an own session and marks the session as used.
   *
   * @throws {ChatError} `sessionMissing` when the session was deleted meanwhile;
   * `messageAlreadySent` when a message of the session already carries the
   * client message ID, and then nothing is changed.
   */
  public async append(
    userId: string,
    sessionId: string,
    message: NewChatMessage,
  ): Promise<StoredChatMessage> {
    const id = randomUUID();
    return this.database.transaction(async (transaction) => {
      const updated = await transaction.query(
        `
        UPDATE chat_sessions
        SET last_message_at = utc_now()
        WHERE id = $session_id
            AND user_id = $user_id
        RETURNING id;
      `,
        { session_id: sessionId, user_id: userId },
      );
      if (updated.length === 0) throw new ChatError("sessionMissing");
      // The unique index on the client message ID refuses a message sent twice.
      const rows = await transaction.query(
        `
        INSERT INTO chat_messages (
            id,
            session_id,
            position,
            role,
            content,
            client_message_id,
            is_stopped
        )
        SELECT
            $id,
            $session_id,
            COALESCE(MAX(position), 0) + 1,
            $role,
            $content,
            $client_message_id,
            $is_stopped
        FROM chat_messages
        WHERE session_id = $session_id
        ON CONFLICT DO NOTHING
        RETURNING
            id,
            role,
            content,
            created_at,
            is_stopped;
      `,
        {
          id,
          session_id: sessionId,
          role: message.role,
          content: message.content,
          client_message_id: message.clientMessageId ?? null,
          is_stopped: message.isStopped ?? null,
        },
      );
      if (rows.length === 0) throw new ChatError("messageAlreadySent");
      return readMessage(rows[0]);
    });
  }

  /**
   * Deletes an own session with its messages and attachment rows.
   *
   * @returns The storage names of the deleted attachments, or `null` when the
   * session is not the person's.
   */
  public async remove(
    userId: string,
    sessionId: string,
  ): Promise<readonly string[] | null> {
    return this.database.transaction(async (transaction) => {
      const owned = await transaction.query(
        "SELECT id FROM chat_sessions WHERE id = $id AND user_id = $user_id;",
        { id: sessionId, user_id: userId },
      );
      if (owned.length === 0) return null;
      const files = await transaction.query(
        `
        DELETE FROM chat_attachments
        WHERE session_id = $session_id
        RETURNING storage_name;
      `,
        { session_id: sessionId },
      );
      await transaction.execute(
        "DELETE FROM chat_messages WHERE session_id = $session_id;",
        { session_id: sessionId },
      );
      await removeAcpJobs(transaction, sessionId);
      await transaction.execute(
        "DELETE FROM chat_sessions WHERE id = $session_id;",
        { session_id: sessionId },
      );
      return files.map((row) => readTextColumn(row, 0, "storage_name"));
    });
  }
}
