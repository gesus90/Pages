import { readTextColumn } from "@/backend/database/RowValue";

import type { Database } from "@/backend/database/Database";
import type { AutomationNotificationMode } from "@/definition/Automation";

/** The mode of a person without a stored choice. */
export const DEFAULT_AUTOMATION_NOTIFICATION: AutomationNotificationMode =
  "error";

/** Stores when a person hears about the runs of their automations (PAGE-297). */
export class AutomationNotificationPreferenceRepository {
  private readonly database: Pick<Database, "query" | "execute">;

  /**
   * Creates the repository.
   *
   * @param database - The database.
   */
  public constructor(database: Pick<Database, "query" | "execute">) {
    this.database = database;
  }

  /** Reads the mode of a person; on errors without a stored choice. */
  public async find(userId: string): Promise<AutomationNotificationMode> {
    const [row] = await this.database.query(
      "SELECT mode FROM automation_notification_preferences WHERE user_id = $user_id;",
      { user_id: userId },
    );
    const mode = row ? readTextColumn(row, 0, "mode") : null;
    return mode === "off" || mode === "always" || mode === "error"
      ? mode
      : DEFAULT_AUTOMATION_NOTIFICATION;
  }

  /** Stores the mode of a person. */
  public async save(
    userId: string,
    mode: AutomationNotificationMode,
    updatedAt: string,
  ): Promise<void> {
    await this.database.execute(
      `
      INSERT INTO automation_notification_preferences (
          user_id,
          mode,
          updated_at
      )
      VALUES (
          $user_id,
          $mode,
          $updated_at
      )
      ON CONFLICT (user_id) DO UPDATE SET
          mode = excluded.mode,
          updated_at = excluded.updated_at;
    `,
      { user_id: userId, mode, updated_at: updatedAt },
    );
  }
}
