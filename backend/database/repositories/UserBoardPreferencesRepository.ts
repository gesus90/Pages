import { readTextColumn } from "@/backend/database/RowValue";

import type { Database } from "@/backend/database/Database";

/** Owns persistence operations for the task board view of each user. */
export class UserBoardPreferencesRepository {
  private readonly database: Database;

  /**
   * Creates a board preferences repository.
   *
   * @param database - Central database access.
   */
  public constructor(database: Database) {
    this.database = database;
  }

  /**
   * Returns the stored board preferences of a user.
   *
   * @param userId - User identifier.
   * @returns The stored text, or `null` when the user saved nothing yet.
   */
  public async findByUserId(userId: string): Promise<string | null> {
    const rows = await this.database.query(
      `
        SELECT
            preferences
        FROM user_board_preferences
        WHERE user_id = $user_id;
      `,
      { user_id: userId },
    );
    const row = rows[0];

    return row ? readTextColumn(row, 0, "preferences") : null;
  }

  /**
   * Creates or replaces the stored board preferences of a user.
   *
   * @param userId - User identifier.
   * @param preferences - Normalized preferences text to persist.
   */
  public async upsert(userId: string, preferences: string): Promise<void> {
    await this.database.execute(
      `
        INSERT INTO user_board_preferences (
            user_id,
            preferences,
            updated_at
        )
        VALUES (
            $user_id,
            $preferences,
            utc_now()
        )
        ON CONFLICT (user_id) DO UPDATE SET
            preferences = excluded.preferences,
            updated_at = excluded.updated_at;
      `,
      { preferences, user_id: userId },
    );
  }
}
