import { readCountColumn } from "@/backend/database/RowValue";
import { AgentError } from "@/backend/error/AgentErrors";
import { AGENT_CHAT_TASK_LIMIT_DEFAULT } from "@/definition/AgentChatTask";
import { AGENT_CHAT_HOURLY_LIMIT_DEFAULT } from "@/definition/Conversation";

import type { Database } from "@/backend/database/Database";
import type { AgentChatSettings } from "@/definition/Conversation";

/** Persists the settings of the chat of agents of the instance (PAGE-311, PAGE-392). */
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
          revision,
          scheduled_task_limit
      FROM agent_chat_settings
      WHERE id = 1;
    `);
    if (!row)
      return {
        hourlyMessageLimit: AGENT_CHAT_HOURLY_LIMIT_DEFAULT,
        scheduledTaskLimit: AGENT_CHAT_TASK_LIMIT_DEFAULT,
        revision: 1,
      };
    return {
      hourlyMessageLimit: readCountColumn(row, 0, "hourly_message_limit"),
      revision: readCountColumn(row, 1, "revision"),
      scheduledTaskLimit: readCountColumn(row, 2, "scheduled_task_limit"),
    };
  }

  /**
   * Replaces the hourly limit and the limit of tasks per chat with
   * optimistic concurrency.
   *
   * @param settings - The new setting with the revision it was read at.
   * @throws {AgentError} `profile_conflict` when the setting changed since.
   */
  public async save(settings: AgentChatSettings): Promise<void> {
    const rows = await this.database.query(
      `
        UPDATE agent_chat_settings
        SET hourly_message_limit = $hourly_message_limit,
            scheduled_task_limit = $scheduled_task_limit,
            revision = revision + 1,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = 1
            AND revision = $revision
        RETURNING id;
      `,
      {
        hourly_message_limit: settings.hourlyMessageLimit,
        scheduled_task_limit: settings.scheduledTaskLimit,
        revision: settings.revision,
      },
    );
    if (rows.length === 0) throw new AgentError("profile_conflict");
  }
}
