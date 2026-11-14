import {
  readCountColumn,
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";

import type { Database } from "@/backend/database/Database";
import type { AgentChatKind } from "@/definition/AgentChatSession";

/** A chat session whose chat may need the background summary of the Lagebuch. */
export interface PendingLogbookSession {
  readonly sessionId: string;
  readonly agentId: string;
  readonly kind: AgentChatKind;
  /** The person of a direct chat or the conversation of a group. */
  readonly chatId: string;
  readonly chatName: string;
  /** ISO time the last round of the session ended. */
  readonly lastActivityAt: string;
  /** The position of the chat the summary read up to. */
  readonly through: number;
  /** The minutes of quiet its agent waits for. */
  readonly quietMinutes: number;
}

/**
 * What the chat sessions remember of the Lagebuch of their agent (PAGE-377):
 * the newest entry they were told about and how far the background summary
 * read their chat.
 *
 * @remarks
 * The state lives in the row of `agent_conversations`, which only the rows of
 * the purposes `chat` and `conversation` use for chats.
 */
export class AgentLogbookSessionRepository {
  private readonly database: Pick<Database, "query" | "execute">;

  public constructor(database: Pick<Database, "query" | "execute">) {
    this.database = database;
  }

  /** The newest entry a session was told about; `0` before the first hint. */
  public async seen(sessionId: string): Promise<number> {
    const [row] = await this.database.query(
      `
        SELECT logbook_seen
        FROM agent_conversations
        WHERE chat_session_id = $session_id;
      `,
      { session_id: sessionId },
    );
    return row ? readCountColumn(row, 0, "logbook_seen") : 0;
  }

  /** Records that a session was told about the entries up to a sequence; the stand only moves forward. */
  public async saveSeen(sessionId: string, sequence: number): Promise<void> {
    await this.database.execute(
      `
        UPDATE agent_conversations
        SET logbook_seen = GREATEST(logbook_seen, $sequence)
        WHERE chat_session_id = $session_id;
      `,
      { session_id: sessionId, sequence },
    );
  }

  /**
   * The chat sessions with a round that ended after their last background
   * summary and no confidential chat.
   *
   * @remarks
   * Whether such a session has been quiet long enough depends on the quiet
   * time of its agent; the caller compares it with `lastActivityAt`.
   */
  public async pending(): Promise<PendingLogbookSession[]> {
    const rows = await this.database.query(
      `
        SELECT
            agent_conversations.chat_session_id,
            agent_conversations.agent_id,
            agent_conversations.purpose,
            agent_conversations.person_id,
            COALESCE(conversations.name, people.display_name, '') AS chat_name,
            agent_conversations.last_activity_at,
            agent_conversations.logbook_through,
            agent_employees.logbook_quiet_minutes
        FROM agent_conversations
        INNER JOIN agent_employees
            ON agent_employees.user_id = agent_conversations.agent_id
        LEFT JOIN conversations
            ON agent_conversations.purpose = 'conversation'
            AND conversations.id = agent_conversations.person_id
        LEFT JOIN users AS people
            ON agent_conversations.purpose = 'chat'
            AND people.id = agent_conversations.person_id
        WHERE agent_conversations.purpose IN ('chat', 'conversation')
            AND agent_conversations.last_activity_at IS NOT NULL
            AND (
                agent_conversations.logbook_processed_at IS NULL
                OR agent_conversations.logbook_processed_at < agent_conversations.last_activity_at
            )
            AND NOT COALESCE(
                CASE
                    WHEN agent_conversations.purpose = 'chat'
                        THEN agent_conversations.is_confidential
                    ELSE conversations.is_confidential
                END,
                FALSE
            )
        ORDER BY agent_conversations.last_activity_at;
      `,
    );
    return rows.map((row) => ({
      sessionId: readTextColumn(row, 0, "chat_session_id"),
      agentId: readTextColumn(row, 1, "agent_id"),
      kind: readTextColumn(row, 2, "purpose") === "chat" ? "direct" : "group",
      chatId: readTextColumn(row, 3, "person_id"),
      chatName: readTextColumn(row, 4, "chat_name"),
      lastActivityAt: readNullableTextColumn(row, 5, "last_activity_at") ?? "",
      through: readCountColumn(row, 6, "logbook_through"),
      quietMinutes: readCountColumn(row, 7, "logbook_quiet_minutes"),
    }));
  }

  /**
   * Records how far the background summary read the chat of a session.
   *
   * @param sessionId - The chat session.
   * @param progress - The position read up to; `processedAt` is set only when the whole chat was read, otherwise the session stays due.
   */
  public async saveProgress(
    sessionId: string,
    progress: { readonly through: number; readonly processedAt: string | null },
  ): Promise<void> {
    await this.database.execute(
      `
        UPDATE agent_conversations
        SET
            logbook_through = GREATEST(logbook_through, $through),
            logbook_processed_at = COALESCE($processed_at, logbook_processed_at)
        WHERE chat_session_id = $session_id;
      `,
      {
        session_id: sessionId,
        through: progress.through,
        processed_at: progress.processedAt,
      },
    );
  }
}
