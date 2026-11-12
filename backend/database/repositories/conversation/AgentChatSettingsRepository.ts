import { readCountColumn } from "@/backend/database/RowValue";
import { AgentError } from "@/backend/error/AgentErrors";
import { AGENT_CHAT_HOURLY_LIMIT_DEFAULT } from "@/definition/Conversation";

import type { Database } from "@/backend/database/Database";
import type { AgentChatSettings } from "@/definition/Conversation";

/** Persists the one setting of the chat of agents of the instance (PAGE-311). */
export class AgentChatSettingsRepository {
  private readonly database: Pick<Database, "query">;

  public constructor(database: Pick<Database, "query">) {
    this.database = database;
  }

  /** Reads the setting; a missing row counts as the default. */
  public async read(): Promise<AgentChatSettings> {
    const [row] = await this.database.query(`
      SELECT
          hourly_message_limit,
          revision
      FROM agent_chat_settings
      WHERE id = 1;
    `);
    if (!row)
      return {
        hourlyMessageLimit: AGENT_CHAT_HOURLY_LIMIT_DEFAULT,
        revision: 1,
      };
    return {
      hourlyMessageLimit: readCountColumn(row, 0, "hourly_message_limit"),
      revision: readCountColumn(row, 1, "revision"),
    };
  }

  /**
   * Replaces the hourly limit with optimistic concurrency.
   *
   * @param settings - The new setting with the revision it was read at.
   * @throws {AgentError} `profile_conflict` when the setting changed since.
   */
  public async save(settings: AgentChatSettings): Promise<void> {
    const rows = await this.database.query(
      `
        UPDATE agent_chat_settings
        SET hourly_message_limit = $hourly_message_limit,
            revision = revision + 1,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = 1
            AND revision = $revision
        RETURNING id;
      `,
      {
        hourly_message_limit: settings.hourlyMessageLimit,
        revision: settings.revision,
      },
    );
    if (rows.length === 0) throw new AgentError("profile_conflict");
  }
}
