import { readCount } from "./WikiPageRows";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type { WikiSettings } from "@/definition/Wiki";

/** Owns persistence of the wiki settings row. */
export class WikiSettingsRepository {
  private readonly database: DatabaseTransaction;

  /**
   * Creates the repository.
   *
   * @param database - Database access or the transaction to run in.
   */
  public constructor(database: DatabaseTransaction) {
    this.database = database;
  }

  /**
   * Reads the stored settings.
   *
   * @returns The settings, or `null` while an administrator never saved any.
   */
  public async find(): Promise<WikiSettings | null> {
    const rows = await this.database.query(`
      SELECT
          trash_retention_days,
          version_retention_days,
          version_keep_last,
          media_limit_bytes,
          file_limit_bytes
      FROM wiki_settings
      WHERE id = 1;
    `);
    const row = rows[0];

    if (!row) {
      return null;
    }

    return {
      fileLimitBytes: readCount(row, 4, "file_limit_bytes"),
      mediaLimitBytes: readCount(row, 3, "media_limit_bytes"),
      trashRetentionDays: readCount(row, 0, "trash_retention_days"),
      versionKeepLast: readCount(row, 2, "version_keep_last"),
      versionRetentionDays: readCount(row, 1, "version_retention_days"),
    };
  }

  /**
   * Stores the settings, replacing earlier ones.
   *
   * @param settings - Validated values.
   */
  public async save(settings: WikiSettings): Promise<void> {
    await this.database.execute(
      `
        INSERT INTO wiki_settings (
            id,
            trash_retention_days,
            version_retention_days,
            version_keep_last,
            media_limit_bytes,
            file_limit_bytes
        )
        VALUES (
            1,
            $trash_retention_days,
            $version_retention_days,
            $version_keep_last,
            $media_limit_bytes,
            $file_limit_bytes
        )
        ON CONFLICT (id) DO UPDATE SET
            trash_retention_days = excluded.trash_retention_days,
            version_retention_days = excluded.version_retention_days,
            version_keep_last = excluded.version_keep_last,
            media_limit_bytes = excluded.media_limit_bytes,
            file_limit_bytes = excluded.file_limit_bytes,
            updated_at = utc_now();
      `,
      {
        file_limit_bytes: settings.fileLimitBytes,
        media_limit_bytes: settings.mediaLimitBytes,
        trash_retention_days: settings.trashRetentionDays,
        version_keep_last: settings.versionKeepLast,
        version_retention_days: settings.versionRetentionDays,
      },
    );
  }
}
