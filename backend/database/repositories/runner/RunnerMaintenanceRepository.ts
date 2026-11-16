import { readTextColumn } from "@/backend/database/RowValue";
import {
  runnerMaintenanceSchema,
  runnerSettingsSchema,
} from "@/definition/RunnerMaintenance";

import type { Database } from "@/backend/database/Database";
import type {
  RunnerSettings,
  RunnerMaintenanceReceipt,
  RunnerMaintenanceState,
} from "@/definition/RunnerMaintenance";

/** Persists address choices, explicit update intent and the last authenticated update receipt. */
export class RunnerMaintenanceRepository {
  private readonly database: Database;

  public constructor(database: Database) {
    this.database = database;
  }

  /** Reads the global choices without manufacturing an insecure default. */
  public async settings(): Promise<RunnerSettings> {
    const [row] = await this.database.query(
      "SELECT settings_json FROM runner_settings WHERE singleton = 1;",
    );
    return row
      ? runnerSettingsSchema.parse(
          JSON.parse(readTextColumn(row, 0, "settings_json")),
        )
      : { address: null, allowInsecureLan: false, automaticUpdates: true };
  }

  /** Replaces administrator choices atomically. */
  public async save(settings: RunnerSettings): Promise<void> {
    await this.database.execute(
      `
      INSERT INTO runner_settings (singleton, settings_json)
      VALUES (1, $settings_json)
      ON CONFLICT (singleton) DO UPDATE SET settings_json = EXCLUDED.settings_json;
    `,
      { settings_json: JSON.stringify(settings) },
    );
  }

  /** Keeps a manual request through disconnects and Pages restarts. */
  public async request(connectionId: string): Promise<void> {
    await this.database.execute(
      `
      INSERT INTO runner_maintenance (connection_id, requested)
      VALUES ($connection_id, TRUE)
      ON CONFLICT (connection_id) DO UPDATE SET requested = TRUE;
    `,
      { connection_id: connectionId },
    );
  }

  /** Reads durable intent and the most recent receipt for the settings UI. */
  public async state(connectionId: string): Promise<RunnerMaintenanceState> {
    const [row] = await this.database.query(
      `
      SELECT
          requested::text,
          receipt_json
      FROM runner_maintenance
      WHERE connection_id = $connection_id;
    `,
      { connection_id: connectionId },
    );
    return {
      requested: row ? readTextColumn(row, 0, "requested") === "true" : false,
      receipt:
        row && row[1] !== null
          ? runnerMaintenanceSchema.parse(
              JSON.parse(readTextColumn(row, 1, "receipt_json")),
            )
          : null,
    };
  }

  /** Stores receipts and settles manual intent after a verified version or an explicit failure. */
  public async record(
    connectionId: string,
    receipt: RunnerMaintenanceReceipt,
    isVerified: boolean,
  ): Promise<void> {
    await this.database.execute(
      `
      INSERT INTO runner_maintenance (connection_id, receipt_json)
      VALUES ($connection_id, $receipt_json)
      ON CONFLICT (connection_id) DO UPDATE SET
          receipt_json = EXCLUDED.receipt_json,
          requested = CASE WHEN $verified THEN FALSE ELSE runner_maintenance.requested END;
    `,
      {
        connection_id: connectionId,
        receipt_json: JSON.stringify(receipt),
        verified: isVerified,
      },
    );
  }
}
