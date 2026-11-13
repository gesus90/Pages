import {
  readCountColumn,
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";
import { AgentError } from "@/backend/error/AgentErrors";

import type { Database, DatabaseValue } from "@/backend/database/Database";
import type { AgentSessionLimits } from "@/definition/AgentSessionLimits";

/** The model the instance names for the background summary of the Lagebuch (PAGE-377). */
export interface StoredLogbookModel {
  readonly connectionId: string;
  readonly model: string;
}

/**
 * Persists the limits of the concurrent chat sessions of agents (PAGE-304)
 * the time of day of the dream run (PAGE-305), the idle time of a
 * resting chat session (PAGE-335) and the instance model of the Lagebuch
 * summary (PAGE-377).
 */
export class AgentSessionSettingsRepository {
  private readonly database: Pick<Database, "query">;

  public constructor(database: Pick<Database, "query">) {
    this.database = database;
  }

  /** Reads the one row of the instance. */
  public async read(): Promise<AgentSessionLimits> {
    const [row] = await this.database.query(`
      SELECT
          per_agent_limit,
          total_limit,
          revision,
          dream_time,
          idle_minutes
      FROM agent_session_settings
      WHERE id = 1;
    `);
    if (!row) throw new AgentError("profile_invalid");
    return {
      perAgent: readCountColumn(row, 0, "per_agent_limit"),
      total: readCountColumn(row, 1, "total_limit"),
      revision: readCountColumn(row, 2, "revision"),
      dreamTime: readTextColumn(row, 3, "dream_time"),
      idleMinutes: readCountColumn(row, 4, "idle_minutes"),
    };
  }

  /**
   * Replaces both limits, the dream time and the idle time with optimistic concurrency.
   *
   * @param limits - The new values with the revision they were read at.
   * @throws {AgentError} `profile_conflict` when the limits changed since.
   */
  public async save(limits: AgentSessionLimits): Promise<void> {
    const rows = await this.database.query(
      `
      UPDATE agent_session_settings
      SET per_agent_limit = $per_agent_limit,
          total_limit = $total_limit,
          dream_time = $dream_time,
          idle_minutes = $idle_minutes,
          revision = revision + 1,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = 1
          AND revision = $revision
      RETURNING id;
    `,
      {
        per_agent_limit: limits.perAgent,
        total_limit: limits.total,
        dream_time: limits.dreamTime,
        idle_minutes: limits.idleMinutes,
        revision: limits.revision,
      },
    );
    if (rows.length === 0) throw new AgentError("profile_conflict");
  }

  /** The model the instance names for the background summary of the Lagebuch; `null` without one. */
  public async logbookModel(): Promise<StoredLogbookModel | null> {
    const [row] = await this.database.query(`
      SELECT
          logbook_connection_id,
          logbook_model
      FROM agent_session_settings
      WHERE id = 1;
    `);
    if (!row) return null;
    const connectionId = readNullableTextColumn(row, 0, "logbook_connection_id");
    const model = readNullableTextColumn(row, 1, "logbook_model");
    return connectionId !== null && model !== null
      ? { connectionId, model }
      : null;
  }

  /**
   * Saves the model of the Lagebuch summary of the instance, `null` for none.
   *
   * @remarks
   * The revision of the limits stays: the model is saved on its own and must
   * not make a concurrent save of the limits conflict.
   */
  public async saveLogbookModel(
    model: StoredLogbookModel | null,
  ): Promise<void> {
    const parameters: Record<string, DatabaseValue> = {
      connection_id: model?.connectionId ?? null,
      model: model?.model ?? null,
    };
    await this.database.query(
      `
      UPDATE agent_session_settings
      SET logbook_connection_id = $connection_id,
          logbook_model = $model,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = 1
      RETURNING id;
    `,
      parameters,
    );
  }
}
