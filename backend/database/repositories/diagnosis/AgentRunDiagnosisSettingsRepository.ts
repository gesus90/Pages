import { readCountColumn } from "@/backend/database/RowValue";
import { AgentError } from "@/backend/error/AgentErrors";
import {
  AGENT_RUN_LOG_RETENTION_DEFAULT,
  AGENT_RUN_STALL_MINUTES_DEFAULT,
} from "@/definition/AgentRunDiagnosis";

import type { Database } from "@/backend/database/Database";
import type { AgentRunDiagnosisSettings } from "@/definition/AgentRunDiagnosis";

/** Persists the one diagnosis setting row of the instance (PAGE-307). */
export class AgentRunDiagnosisSettingsRepository {
  private readonly database: Pick<Database, "query">;

  public constructor(database: Pick<Database, "query">) {
    this.database = database;
  }

  /** Reads the settings; a missing row counts as the defaults. */
  public async read(): Promise<AgentRunDiagnosisSettings> {
    const [row] = await this.database.query(`
      SELECT
          log_retention_days,
          stall_minutes,
          revision
      FROM agent_run_diagnosis_settings
      WHERE id = 1;
    `);
    if (!row)
      return {
        logRetentionDays: AGENT_RUN_LOG_RETENTION_DEFAULT,
        stallMinutes: AGENT_RUN_STALL_MINUTES_DEFAULT,
        revision: 1,
      };
    return {
      logRetentionDays: readCountColumn(row, 0, "log_retention_days"),
      stallMinutes: readCountColumn(row, 1, "stall_minutes"),
      revision: readCountColumn(row, 2, "revision"),
    };
  }

  /**
   * Replaces the settings with optimistic concurrency.
   *
   * @param settings - The new settings with the revision they were read at.
   * @throws {AgentError} `profile_conflict` when the settings changed since.
   */
  public async save(settings: AgentRunDiagnosisSettings): Promise<void> {
    const rows = await this.database.query(
      `
        UPDATE agent_run_diagnosis_settings
        SET log_retention_days = $log_retention_days,
            stall_minutes = $stall_minutes,
            revision = revision + 1,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = 1
            AND revision = $revision
        RETURNING id;
      `,
      {
        log_retention_days: settings.logRetentionDays,
        stall_minutes: settings.stallMinutes,
        revision: settings.revision,
      },
    );
    if (rows.length === 0) throw new AgentError("profile_conflict");
  }
}
