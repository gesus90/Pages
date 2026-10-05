import { readTextColumn } from "@/backend/database/RowValue";

import type { Database } from "@/backend/database/Database";

/** What the setup wizard stores about the instance. */
export interface InstanceSettings {
  readonly companyName: string;
  readonly primaryAdministratorId: string;
}

/** Owns persistence of the instance-wide settings row. */
export class InstanceSettingsRepository {
  private readonly database: Database;

  /**
   * Creates an instance settings repository.
   *
   * @param database - Central database access.
   */
  public constructor(database: Database) {
    this.database = database;
  }

  /**
   * Returns the stored instance settings.
   *
   * @returns The settings, or `null` before the first setup finished.
   */
  public async find(): Promise<InstanceSettings | null> {
    const rows = await this.database.query(`
      SELECT
          company_name,
          primary_administrator_id
      FROM instance_settings
      WHERE id = 1;
    `);
    const row = rows[0];

    if (!row) {
      return null;
    }

    return {
      companyName: readTextColumn(row, 0, "company_name"),
      primaryAdministratorId: readTextColumn(
        row,
        1,
        "primary_administrator_id",
      ),
    };
  }

  /**
   * Stores the instance settings, replacing earlier ones.
   *
   * @param settings - Company name and administrator of the latest setup.
   */
  public async save(settings: InstanceSettings): Promise<void> {
    await this.database.execute(
      `
        INSERT INTO instance_settings (
            id,
            company_name,
            primary_administrator_id
        )
        VALUES (
            1,
            $company_name,
            $primary_administrator_id
        )
        ON CONFLICT (id) DO UPDATE SET
            company_name = excluded.company_name,
            primary_administrator_id = excluded.primary_administrator_id,
            updated_at = utc_now();
      `,
      {
        company_name: settings.companyName,
        primary_administrator_id: settings.primaryAdministratorId,
      },
    );
  }
}
