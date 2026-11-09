import {
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";

import type { Database } from "@/backend/database/Database";

/** The stored live progress of one step in a run, its todos as JSON. */
export interface StoredPlanStepProgress {
  readonly runId: string;
  readonly stepId: string;
  readonly attemptId: string;
  readonly todosJson: string;
  readonly activity: string | null;
  readonly updatedAt: string;
}

/** Stores what `update_step_progress` reported, one row per run and step (PAGE-284). */
export class AgentPlanStepProgressRepository {
  private readonly database: Pick<Database, "query" | "execute">;

  public constructor(database: Pick<Database, "query" | "execute">) {
    this.database = database;
  }

  /** Reads the progress of one step; `null` before its first report. */
  public async find(
    runId: string,
    stepId: string,
  ): Promise<StoredPlanStepProgress | null> {
    const [row] = await this.database.query(
      `
      SELECT
          run_id,
          step_id,
          attempt_id,
          todos_json,
          activity,
          updated_at
      FROM agent_plan_step_progress
      WHERE run_id = $run_id
          AND step_id = $step_id;
    `,
      { run_id: runId, step_id: stepId },
    );
    return row ? readProgressRow(row) : null;
  }

  /** Reads the progress of every step of a run that reported one. */
  public async listForRun(
    runId: string,
  ): Promise<readonly StoredPlanStepProgress[]> {
    const rows = await this.database.query(
      `
      SELECT
          run_id,
          step_id,
          attempt_id,
          todos_json,
          activity,
          updated_at
      FROM agent_plan_step_progress
      WHERE run_id = $run_id
      ORDER BY step_id;
    `,
      { run_id: runId },
    );
    return rows.map(readProgressRow);
  }

  /** Stores the merged progress of a step; a later report replaces it. */
  public async save(progress: StoredPlanStepProgress): Promise<void> {
    await this.database.execute(
      `
      INSERT INTO agent_plan_step_progress (
          run_id,
          step_id,
          attempt_id,
          todos_json,
          activity,
          updated_at
      )
      VALUES (
          $run_id,
          $step_id,
          $attempt_id,
          $todos_json,
          $activity,
          $updated_at
      )
      ON CONFLICT (run_id, step_id) DO UPDATE SET
          attempt_id = excluded.attempt_id,
          todos_json = excluded.todos_json,
          activity = excluded.activity,
          updated_at = excluded.updated_at;
    `,
      {
        run_id: progress.runId,
        step_id: progress.stepId,
        attempt_id: progress.attemptId,
        todos_json: progress.todosJson,
        activity: progress.activity,
        updated_at: progress.updatedAt,
      },
    );
  }
}

function readProgressRow(
  row: Parameters<typeof readTextColumn>[0],
): StoredPlanStepProgress {
  return {
    runId: readTextColumn(row, 0, "run_id"),
    stepId: readTextColumn(row, 1, "step_id"),
    attemptId: readTextColumn(row, 2, "attempt_id"),
    todosJson: readTextColumn(row, 3, "todos_json"),
    activity: readNullableTextColumn(row, 4, "activity"),
    updatedAt: readTextColumn(row, 5, "updated_at"),
  };
}
