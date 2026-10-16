import {
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";

import type { Database } from "@/backend/database/Database";

/**
 * The agent session that continues one conversation.
 *
 * @remarks
 * It is continued only with the same connection, model, reasoning effort and
 * profile, and only while no message reached the conversation past
 * `throughMessageId` on another path.
 */
export interface ChatAcpSession {
  readonly chatSessionId: string;
  readonly userId: string;
  readonly connectionId: string;
  readonly model: string;
  readonly reasoningEffort: string | null;
  readonly profile: string;
  readonly acpSessionId: string;
  readonly throughMessageId: string | null;
}

/** Owner-bound mapping of a conversation to its agent session (PAGE-68). */
export class ChatAcpSessionRepository {
  private readonly database: Pick<Database, "query" | "execute">;

  public constructor(database: Pick<Database, "query" | "execute">) {
    this.database = database;
  }

  /** Returns the agent session of an own conversation. */
  public async find(
    userId: string,
    chatSessionId: string,
  ): Promise<ChatAcpSession | null> {
    const rows = await this.database.query(
      `
      SELECT
          chat_session_id,
          user_id,
          connection_id,
          model,
          reasoning_effort,
          profile,
          acp_session_id,
          through_message_id
      FROM chat_acp_sessions
      WHERE chat_session_id = $chat_session_id
          AND user_id = $user_id;
    `,
      { chat_session_id: chatSessionId, user_id: userId },
    );
    if (rows.length === 0) return null;
    const row = rows[0];
    return {
      chatSessionId: readTextColumn(row, 0, "chat_session_id"),
      userId: readTextColumn(row, 1, "user_id"),
      connectionId: readTextColumn(row, 2, "connection_id"),
      model: readTextColumn(row, 3, "model"),
      reasoningEffort: readNullableTextColumn(row, 4, "reasoning_effort"),
      profile: readTextColumn(row, 5, "profile"),
      acpSessionId: readTextColumn(row, 6, "acp_session_id"),
      throughMessageId: readNullableTextColumn(row, 7, "through_message_id"),
    };
  }

  /** Stores the agent session a job opened or continued. */
  public async save(session: ChatAcpSession): Promise<void> {
    await this.database.execute(
      `
      INSERT INTO chat_acp_sessions (
          chat_session_id,
          user_id,
          connection_id,
          model,
          reasoning_effort,
          profile,
          acp_session_id,
          through_message_id
      )
      VALUES (
          $chat_session_id,
          $user_id,
          $connection_id,
          $model,
          $reasoning_effort,
          $profile,
          $acp_session_id,
          $through_message_id
      )
      ON CONFLICT (chat_session_id) DO UPDATE SET
          connection_id = excluded.connection_id,
          model = excluded.model,
          reasoning_effort = excluded.reasoning_effort,
          profile = excluded.profile,
          acp_session_id = excluded.acp_session_id,
          through_message_id = excluded.through_message_id,
          updated_at = utc_now();
    `,
      {
        chat_session_id: session.chatSessionId,
        user_id: session.userId,
        connection_id: session.connectionId,
        model: session.model,
        reasoning_effort: session.reasoningEffort,
        profile: session.profile,
        acp_session_id: session.acpSessionId,
        through_message_id: session.throughMessageId,
      },
    );
  }

  /** Forgets the agent session of an own conversation, so the next job starts a new one. */
  public async remove(userId: string, chatSessionId: string): Promise<void> {
    await this.database.execute(
      `
      DELETE FROM chat_acp_sessions
      WHERE chat_session_id = $chat_session_id
          AND user_id = $user_id;
    `,
      { chat_session_id: chatSessionId, user_id: userId },
    );
  }
}
