import {
  readNullableBooleanColumn,
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";
import { isLanguage } from "@/language/Language";

import type { Database, DatabaseValue } from "@/backend/database/Database";
import type { Language } from "@/language/Language";

/** A settings row as stored in the database, with every optional value nullable. */
export interface StoredUserSettings {
  readonly language: Language;
  readonly timezone: string | null;
  readonly dateFormat: string | null;
  readonly weekStart: string | null;
  readonly notifyEmail: boolean | null;
  readonly notifyDesktop: boolean | null;
  readonly notifyMentions: boolean | null;
  readonly notifyAssignments: boolean | null;
  readonly notifyDueDates: boolean | null;
  readonly notifyWeeklySummary: boolean | null;
}

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
            utc_now()
        )
        ON CONFLICT (user_id) DO UPDATE SET
            language = excluded.language,
            updated_at = excluded.updated_at;
      `,
      { user_id: userId, language },
    );
  }

  /**
   * Returns the complete settings row of a user.
   *
   * @param userId - User identifier.
   * @returns The stored settings, or `null` when the user has no row yet.
   */
  public async findByUserId(
    userId: string,
  ): Promise<StoredUserSettings | null> {
    const rows = await this.database.query(
      `
        SELECT
            language,
            timezone,
            date_format,
            week_start,
            notify_email,
            notify_desktop,
            notify_mentions,
            notify_assignments,
            notify_due_dates,
            notify_weekly_summary
        FROM user_settings
        WHERE user_id = $user_id;
      `,
      { user_id: userId },
    );

    const row = rows[0];

    return row ? this.toStoredSettings(row) : null;
  }

  /**
   * Creates or replaces the complete settings row of a user.
   *
   * @param userId - User identifier.
   * @param settings - Settings to persist.
   */
  public async upsert(
    userId: string,
    settings: StoredUserSettings,
  ): Promise<void> {
    await this.database.execute(
      `
        INSERT INTO user_settings (
            user_id,
            language,
            timezone,
            date_format,
            week_start,
            notify_email,
            notify_desktop,
            notify_mentions,
            notify_assignments,
            notify_due_dates,
            notify_weekly_summary,
            updated_at
        )
        VALUES (
            $user_id,
            $language,
            $timezone,
            $date_format,
            $week_start,
            $notify_email,
            $notify_desktop,
            $notify_mentions,
            $notify_assignments,
            $notify_due_dates,
            $notify_weekly_summary,
            utc_now()
        )
        ON CONFLICT (user_id) DO UPDATE SET
            language = excluded.language,
            timezone = excluded.timezone,
            date_format = excluded.date_format,
            week_start = excluded.week_start,
            notify_email = excluded.notify_email,
            notify_desktop = excluded.notify_desktop,
            notify_mentions = excluded.notify_mentions,
            notify_assignments = excluded.notify_assignments,
            notify_due_dates = excluded.notify_due_dates,
            notify_weekly_summary = excluded.notify_weekly_summary,
            updated_at = excluded.updated_at;
      `,
      {
        user_id: userId,
        language: settings.language,
        timezone: settings.timezone,
        date_format: settings.dateFormat,
        week_start: settings.weekStart,
        notify_email: settings.notifyEmail ?? null,
        notify_desktop: settings.notifyDesktop ?? null,
        notify_mentions: settings.notifyMentions ?? null,
        notify_assignments: settings.notifyAssignments ?? null,
        notify_due_dates: settings.notifyDueDates ?? null,
        notify_weekly_summary: settings.notifyWeeklySummary ?? null,
      },
    );
  }

  private toStoredSettings(row: readonly DatabaseValue[]): StoredUserSettings {
    const language = readTextColumn(row, 0, "language");

    if (!isLanguage(language)) {
      throw new Error(
        `Database returned an unsupported language "${language}".`,
      );
    }

    return {
      language,
      timezone: readNullableTextColumn(row, 1, "timezone"),
      dateFormat: readNullableTextColumn(row, 2, "date_format"),
      weekStart: readNullableTextColumn(row, 3, "week_start"),
      notifyEmail: readNullableBooleanColumn(row, 4, "notify_email"),
      notifyDesktop: readNullableBooleanColumn(row, 5, "notify_desktop"),
      notifyMentions: readNullableBooleanColumn(row, 6, "notify_mentions"),
      notifyAssignments: readNullableBooleanColumn(
        row,
        7,
        "notify_assignments",
      ),
      notifyDueDates: readNullableBooleanColumn(row, 8, "notify_due_dates"),
      notifyWeeklySummary: readNullableBooleanColumn(
        row,
        9,
        "notify_weekly_summary",
      ),
    };
  }
}
