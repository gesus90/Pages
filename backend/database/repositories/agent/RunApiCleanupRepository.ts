import { readTextColumn } from "@/backend/database/RowValue";

import type { Database } from "@/backend/database/Database";

/** Deferred revocation survives either process restarting after a remote attempt finishes. */
export interface RunApiCleanup {
  readonly runId: string;
  readonly stepId: string;
  readonly attemptId: string;
}

/** Durable cleanup outbox; only the API consumes its own in-memory capability revocations. */
export class RunApiCleanupRepository {
  private readonly database: Database;

  public constructor(database: Database) {
    this.database = database;
  }

  /** Records idempotent closeout without depending on API availability. */
  public async enqueue(cleanup: RunApiCleanup): Promise<void> {
    await this.database.execute(
      `
      INSERT INTO plan_run_api_cleanup (
          attempt_id,
          run_id,
          step_id
      ) VALUES ($attempt_id, $run_id, $step_id)
      ON CONFLICT (attempt_id) DO NOTHING;
    `,
      {
        attempt_id: cleanup.attemptId,
        run_id: cleanup.runId,
        step_id: cleanup.stepId,
      },
    );
  }

  /** Reads a bounded batch, so a peer outage cannot create an unbounded startup wait. */
  public async pending(): Promise<readonly RunApiCleanup[]> {
    return (
      await this.database.query(`
      SELECT
          attempt_id,
          run_id,
          step_id
      FROM plan_run_api_cleanup
      ORDER BY attempt_id
      LIMIT 100;
    `)
    ).map((row) => ({
      attemptId: readTextColumn(row, 0, "attempt_id"),
      runId: readTextColumn(row, 1, "run_id"),
      stepId: readTextColumn(row, 2, "step_id"),
    }));
  }

  /** Removes the intent only after credential revocation and evidence have committed. */
  public async complete(attemptId: string): Promise<void> {
    await this.database.execute(
      "DELETE FROM plan_run_api_cleanup WHERE attempt_id = $attempt_id;",
      { attempt_id: attemptId },
    );
  }
}
