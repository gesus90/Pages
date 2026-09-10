import { readTextColumn } from "@/backend/database/RowValue";
import { isLanguage } from "@/language/Language";

import type { Database } from "@/backend/database/Database";
import type { Language } from "@/language/Language";

/** Owns persistence operations for personal user settings. */
export class UserSettingsRepository {
  private readonly database: Database;

  /**
   * Creates a user settings repository.
   *
   * @param database - Central database access.
   */
  public constructor(database: Database) {
    this.database = database;
  }

  /**
   * Returns the language a user has chosen.
   *
   * @param userId - User identifier.
   * @returns The stored language, or `null` when the user has no settings row yet.
   */
  public async findLanguageByUserId(userId: string): Promise<Language | null> {
    const rows = await this.database.query(
      `
        SELECT
            language
        FROM user_settings
        WHERE user_id = $user_id;
      `,
      { user_id: userId },
    );

    const row = rows[0];

    if (!row) {
      return null;
    }

    const language = readTextColumn(row, 0, "language");

    if (!isLanguage(language)) {
      throw new Error(
        `Database returned an unsupported language "${language}".`,
      );
    }

    return language;
  }

  /**
   * Creates or updates the language a user has chosen.
   *
   * @param userId - User identifier.
   * @param language - Language to persist.
   */
  public async upsertLanguage(
    userId: string,
    language: Language,
  ): Promise<void> {
    await this.database.execute(
      `
        INSERT INTO user_settings (
            user_id,
            language,
            updated_at
        )
        VALUES (
            $user_id,
            $language,
            CURRENT_TIMESTAMP
        )
        ON CONFLICT (user_id) DO UPDATE SET
            language = excluded.language,
            updated_at = excluded.updated_at;
      `,
      { user_id: userId, language },
    );
  }
}
