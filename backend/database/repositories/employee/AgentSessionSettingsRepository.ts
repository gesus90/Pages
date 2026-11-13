import { readCountColumn, readTextColumn } from "@/backend/database/RowValue";
import { AgentError } from "@/backend/error/AgentErrors";

import type { Database } from "@/backend/database/Database";
import type { AgentSessionLimits } from "@/definition/AgentSessionLimits";

/**
 * Persists the limits of the concurrent chat sessions of agents (PAGE-304)
 * the time of day of the dream run (PAGE-305) and the idle time of a
 * resting chat session (PAGE-335).
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
}
