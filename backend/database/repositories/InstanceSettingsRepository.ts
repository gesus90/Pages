import { readBlobColumn, readTextColumn } from "@/backend/database/RowValue";

import type { Database } from "@/backend/database/Database";

/** What the setup wizard stores about the instance. */
export interface InstanceSettings {
  readonly companyName: string;
  readonly primaryAdministratorId: string;
}

/** The company logo as stored in the database. */
export interface StoredInstanceLogo {
  readonly mimeType: string;
  readonly data: Buffer;
  /** When the logo was stored; changes with every new logo. */
  readonly updatedAt: string;
}

/** Owns persistence of the instance-wide settings row and the company logo. */
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

  /**
   * Replaces the company name.
   *
   * @param companyName - New, already validated name.
   */
  public async updateCompanyName(companyName: string): Promise<void> {
    await this.database.execute(
      `
        UPDATE instance_settings
        SET
            company_name = $company_name,
            updated_at = utc_now()
        WHERE id = 1;
      `,
      { company_name: companyName },
    );
  }

  /**
   * Returns the stored company logo.
   *
   * @returns The logo, or `null` when none was uploaded.
   */
  public async findLogo(): Promise<StoredInstanceLogo | null> {
    const rows = await this.database.query(`
      SELECT
          mime_type,
          data,
          updated_at
      FROM instance_logo
      WHERE id = 1;
    `);
    const row = rows[0];

    if (!row) {
      return null;
    }

    return {
      data: readBlobColumn(row, 1, "data"),
      mimeType: readTextColumn(row, 0, "mime_type"),
      updatedAt: readTextColumn(row, 2, "updated_at"),
    };
  }

  /**
   * Returns when the company logo was stored, without loading its image.
   *
   * @returns The timestamp, or `null` when no logo exists.
   */
  public async findLogoVersion(): Promise<string | null> {
    const rows = await this.database.query(`
      SELECT updated_at
      FROM instance_logo
      WHERE id = 1;
    `);
    const row = rows[0];

    return row ? readTextColumn(row, 0, "updated_at") : null;
  }

  /**
   * Stores the company logo, replacing an earlier one.
   *
   * @param logo - Validated image and its type.
   */
  public async saveLogo(
    logo: Pick<StoredInstanceLogo, "data" | "mimeType">,
  ): Promise<void> {
    await this.database.execute(
      `
        INSERT INTO instance_logo (
            id,
            mime_type,
            data
        )
        VALUES (
            1,
            $mime_type,
            $data
        )
        ON CONFLICT (id) DO UPDATE SET
            mime_type = excluded.mime_type,
            data = excluded.data,
            updated_at = utc_now();
      `,
      { data: logo.data, mime_type: logo.mimeType },
    );
  }

  /** Removes the company logo. */
  public async deleteLogo(): Promise<void> {
    await this.database.execute("DELETE FROM instance_logo WHERE id = 1;");
  }
}
