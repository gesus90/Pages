import { readCountColumn, readTextColumn } from "@/backend/database/RowValue";
import {
  runnerJobSchema,
  runnerStateSchema,
} from "@/definition/RunnerProtocol";

import { AgentPlanAgentTodoRepository } from "../agent/AgentPlanAgentTodoRepository";

import type {
  Database,
  DatabaseTransaction,
} from "@/backend/database/Database";
import type { RunnerJob, RunnerState } from "@/definition/RunnerProtocol";

/** Persisted pairing bound to the exact SSH configuration that authorized it. */
export interface RunnerRecord {
  readonly connectionId: string;
  readonly runnerId: string;
  readonly tokenHash: string;
  readonly connectionRevision: number;
  readonly state: RunnerState;
}

/** Stores runner identities and acknowledged protocol checkpoints in PostgreSQL. */
export class RunnerRepository {
  private readonly database: Database;
  public constructor(database: Database) {
    this.database = database;
  }

  /** Reads the registered runner, including the server-only token digest. */
  public async find(connectionId: string): Promise<RunnerRecord | null> {
    const rows = await this.database.query(
      `
      SELECT
          connection_id,
          runner_id,
          token_hash,
          connection_revision,
          state_json
      FROM pages_runners
      WHERE connection_id = $connection_id;
    `,
      { connection_id: connectionId },
    );
    const row = rows[0];
    if (!row) return null;
    return {
      connectionId: readTextColumn(row, 0, "connection_id"),
      runnerId: readTextColumn(row, 1, "runner_id"),
      tokenHash: readTextColumn(row, 2, "token_hash"),
      connectionRevision: readCountColumn(row, 3, "connection_revision"),
      state: runnerStateSchema.parse(
        JSON.parse(readTextColumn(row, 4, "state_json")),
      ),
    };
  }

  /** Reads an immutable completed job after its live transport entry was retired. */
  public async archivedJob(
    connectionId: string,
    jobId: string,
  ): Promise<RunnerJob | undefined> {
    const [row] = await this.database.query(
      "SELECT job_json::text FROM runner_job_archive WHERE connection_id = $connection_id AND job_id = $job_id;",
      { connection_id: connectionId, job_id: jobId },
    );
    return row
      ? runnerJobSchema.parse(JSON.parse(readTextColumn(row, 0, "job_json")))
      : undefined;
  }

  /** Resolves an acknowledged turn independently of the bounded live job list. */
  public async archivedAttempt(
    connectionId: string,
    runId: string,
    attemptId: string,
  ): Promise<RunnerJob | undefined> {
    const [row] = await this.database.query(
      "SELECT job_json::text FROM runner_job_archive WHERE connection_id = $connection_id AND run_id = $run_id AND attempt_id = $attempt_id;",
      { connection_id: connectionId, run_id: runId, attempt_id: attemptId },
    );
    return row
      ? runnerJobSchema.parse(JSON.parse(readTextColumn(row, 0, "job_json")))
      : undefined;
  }

  /** Reads native TODOs for internal group and swarm observers from the existing attempt journal. */
  public async nativePlan(attemptId: string): Promise<RunnerJob["nativePlan"]> {
    const todos = await new AgentPlanAgentTodoRepository(
      this.database,
    ).findPlan(attemptId);
    return todos?.map((todo) => {
      let status: "pending" | "in_progress" | "completed" = "pending";
      if (todo.status === "active") status = "in_progress";
      if (todo.status === "done") status = "completed";
      return { content: todo.text, status };
    });
  }

  /** Inserts one pairing; an existing identity cannot be replaced by registration. */
  public async create(record: RunnerRecord): Promise<void> {
    await this.database.execute(
      `
      INSERT INTO pages_runners (
          connection_id,
          runner_id,
          token_hash,
          connection_revision,
          state_json
      ) VALUES (
          $connection_id,
          $runner_id,
          $token_hash,
          $connection_revision,
          $state_json
      );
    `,
      {
        connection_id: record.connectionId,
        runner_id: record.runnerId,
        token_hash: record.tokenHash,
        connection_revision: record.connectionRevision,
        state_json: JSON.stringify(record.state),
      },
    );
  }

  /**
   * Commits state before its event acknowledgement is sent.
   * @remarks
   * Only jobs of a run that still exists are archived. Starting a plan again
   * deletes its earlier runs, while the runner keeps their finished jobs in
   * its state; archiving such a job violated the run reference, failed the
   * whole checkpoint and closed the channel at every reconciliation. The share
   * lock keeps a run that is deleted meanwhile from failing the insert.
   */
  public async checkpoint(
    connectionId: string,
    state: RunnerState,
    journal?: (transaction: DatabaseTransaction) => Promise<void>,
  ): Promise<void> {
    await this.database.transaction(async (transaction) => {
      await journal?.(transaction);
      await transaction.execute(
        `
        INSERT INTO runner_job_archive (
            job_id,
            connection_id,
            run_id,
            attempt_id,
            job_json,
            completed_at
        )
        SELECT
            job ->> 'jobId',
            $connection_id,
            job -> 'plan' ->> 'runId',
            job -> 'plan' ->> 'attemptId',
            job,
            utc_now()
        FROM jsonb_array_elements($state_json::jsonb -> 'jobs') AS job
        JOIN agent_plan_runs AS runs ON runs.id = job -> 'plan' ->> 'runId'
        WHERE job -> 'plan' ->> 'managed' = 'true'
            AND job ->> 'status' IN ('completed', 'failed', 'interrupted', 'lost')
            AND (job -> 'outcome' ->> 'closeout' = 'confirmed'
                OR job -> 'cancellation' ->> 'closeout' = 'confirmed')
        FOR KEY SHARE OF runs
        ON CONFLICT (job_id) DO UPDATE SET
            job_json = EXCLUDED.job_json;
      `,
        { connection_id: connectionId, state_json: JSON.stringify(state) },
      );
      await transaction.execute(
        `
      UPDATE pages_runners
      SET state_json = $state_json
      WHERE connection_id = $connection_id;
    `,
        { connection_id: connectionId, state_json: JSON.stringify(state) },
      );
    });
  }

  /** Wakes only obligations of a runner whose authenticated channel became available again. */
  public async reconnected(connectionId: string): Promise<void> {
    await this.database.execute(
      `
      UPDATE agent_workspace_cleanup AS cleanup
      SET attempts = 0, next_attempt_at = 0, retry_started_at = utc_now(),
          event_revision = event_revision + 1, state = 'pending',
          updated_at = CASE WHEN cleanup.state <> 'pending' THEN utc_now() ELSE cleanup.updated_at END
      FROM agent_plan_runs AS runs
      WHERE runs.id = cleanup.run_id AND cleanup.state <> 'completed'
          AND jsonb_path_exists(runs.view_json::jsonb,
              '$.**.connectionId ? (@ == $connection)',
              jsonb_build_object('connection', $connection_id::text));
    `,
      { connection_id: connectionId },
    );
  }

  /** Removes credentials and checkpoints after an explicit administrator revocation. */
  public async remove(connectionId: string): Promise<void> {
    await this.database.execute(
      "DELETE FROM pages_runners WHERE connection_id = $connection_id;",
      { connection_id: connectionId },
    );
  }
}
