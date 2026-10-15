import {
  readCountColumn,
  readNullableTextColumn,
} from "@/backend/database/RowValue";

import type { Database } from "@/backend/database/Database";

/** Persisted summary boundary; the original messages stay untouched. */
export interface StoredChatContext {
  readonly summary: string | null;
  readonly throughId: string | null;
  readonly revision: number;
}

/** Own-session context snapshots and optimistic summary replacement. */
export class ChatContextRepository {
  private readonly database: Pick<Database, "query">;

  public constructor(database: Pick<Database, "query">) {
    this.database = database;
  }

  /** Reads a summary only within its owner's session. */
  public async read(
    userId: string,
    sessionId: string,
  ): Promise<StoredChatContext | null> {
    const rows = await this.database.query(
      `
      SELECT
          context_summary,
          context_through_id,
          context_revision
      FROM chat_sessions
      WHERE id = $session_id
          AND user_id = $user_id;
    `,
      { user_id: userId, session_id: sessionId },
    );
    if (rows.length === 0) return null;
    return {
      summary: readNullableTextColumn(rows[0], 0, "context_summary"),
      throughId: readNullableTextColumn(rows[0], 1, "context_through_id"),
      revision: readCountColumn(rows[0], 2, "context_revision"),
    };
  }

  /** Commits only if both context and latest message still match the snapshot. */
  public async save(
    userId: string,
    sessionId: string,
    replacement: {
      readonly summary: string;
      readonly throughId: string;
      readonly expectedRevision: number;
      readonly latestId: string;
    },
  ): Promise<boolean> {
    const rows = await this.database.query(
      `
      UPDATE chat_sessions
      SET context_summary = $summary,
          context_through_id = $through_id,
          context_revision = context_revision + 1
      WHERE id = $session_id
          AND user_id = $user_id
          AND context_revision = $expected_revision
          AND $latest_id = (
              SELECT id
              FROM chat_messages
              WHERE session_id = $session_id
              ORDER BY position DESC
              LIMIT 1
          )
      RETURNING id;
    `,
      {
        user_id: userId,
        session_id: sessionId,
        summary: replacement.summary,
        through_id: replacement.throughId,
        expected_revision: replacement.expectedRevision,
        latest_id: replacement.latestId,
      },
    );
    return rows.length > 0;
  }
}
