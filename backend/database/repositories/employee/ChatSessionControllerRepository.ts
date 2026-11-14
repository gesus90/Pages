import { readTextColumn } from "@/backend/database/RowValue";

import type { Database } from "@/backend/database/Database";

/**
 * The members of a group its creator allows to steer the agents of the group
 * (PAGE-380): to change their model, to restart and to compact their sessions.
 *
 * @remarks
 * The creator may always and is never stored; a dissolved group takes its
 * rows along.
 */
export class ChatSessionControllerRepository {
  private readonly database: Pick<Database, "query" | "execute" | "transaction">;

  public constructor(database: Pick<Database, "query" | "execute" | "transaction">) {
    this.database = database;
  }

  /** The members allowed besides the creator. */
  public async list(conversationId: string): Promise<string[]> {
    const rows = await this.database.query(
      `
        SELECT user_id
        FROM conversation_session_controllers
        WHERE conversation_id = $conversation_id
        ORDER BY added_at, user_id;
      `,
      { conversation_id: conversationId },
    );
    return rows.map((row) => readTextColumn(row, 0, "user_id"));
  }

  /** Replaces the members allowed besides the creator. */
  public async replace(
    conversationId: string,
    change: { readonly userIds: readonly string[]; readonly at: string },
  ): Promise<void> {
    await this.database.transaction(async (transaction) => {
      await transaction.execute(
        `
          DELETE FROM conversation_session_controllers
          WHERE conversation_id = $conversation_id;
        `,
        { conversation_id: conversationId },
      );
      for (const userId of change.userIds)
        await transaction.execute(
          `
            INSERT INTO conversation_session_controllers (
                conversation_id,
                user_id,
                added_at
            )
            VALUES (
                $conversation_id,
                $user_id,
                $added_at
            )
            ON CONFLICT (conversation_id, user_id) DO NOTHING;
          `,
          {
            conversation_id: conversationId,
            user_id: userId,
            added_at: change.at,
          },
        );
    });
  }

  /** Takes the right from one member, such as one removed from the group. */
  public async remove(conversationId: string, userId: string): Promise<void> {
    await this.database.execute(
      `
        DELETE FROM conversation_session_controllers
        WHERE conversation_id = $conversation_id
            AND user_id = $user_id;
      `,
      { conversation_id: conversationId, user_id: userId },
    );
  }
}
