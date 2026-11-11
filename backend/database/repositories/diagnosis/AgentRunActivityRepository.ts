import {
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";

import type { Database } from "@/backend/database/Database";

/** When a run last showed life, per attempt and per step. */
export interface RunActivity {
  /** The newest journal event of each attempt. */
  readonly attemptEvents: ReadonlyMap<string, string>;
  /** The newest progress report of each step. */
  readonly stepProgress: ReadonlyMap<string, string>;
  /** The newest log line of each attempt. */
  readonly attemptLogs: ReadonlyMap<string, string>;
}

/** Reads the signs of life of a run, which the timeline uses to find stalled steps (PAGE-307). */
export class AgentRunActivityRepository {
  private readonly database: Pick<Database, "query">;

  public constructor(database: Pick<Database, "query">) {
    this.database = database;
  }

  /**
   * Reads the newest event time of every attempt and step of a run.
   *
   * @param runId - The run.
   */
  public async read(runId: string): Promise<RunActivity> {
    const [events, progress, logs] = await Promise.all([
      this.database.query(
        `
        SELECT
            attempts.attempt_id,
            MAX(events.created_at)
        FROM agent_session_attempts AS attempts
        INNER JOIN agent_session_events AS events
            ON events.attempt_id = attempts.attempt_id
        WHERE attempts.run_id = $run_id
        GROUP BY attempts.attempt_id;
      `,
        { run_id: runId },
      ),
      this.database.query(
        `
        SELECT
            step_id,
            updated_at
        FROM agent_plan_step_progress
        WHERE run_id = $run_id;
      `,
        { run_id: runId },
      ),
      this.database.query(
        `
        SELECT
            attempt_id,
            MAX(logged_at)
        FROM agent_run_logs
        WHERE run_id = $run_id
            AND attempt_id IS NOT NULL
        GROUP BY attempt_id;
      `,
        { run_id: runId },
      ),
    ]);
    return {
      attemptEvents: pairs(events),
      stepProgress: pairs(progress),
      attemptLogs: pairs(logs),
    };
  }
}

function pairs(
  rows: readonly (readonly (string | number | bigint | Buffer | null)[])[],
): ReadonlyMap<string, string> {
  const result = new Map<string, string>();
  for (const row of rows) {
    const time = readNullableTextColumn(row, 1, "time");
    if (time !== null) result.set(readTextColumn(row, 0, "id"), time);
  }
  return result;
}
