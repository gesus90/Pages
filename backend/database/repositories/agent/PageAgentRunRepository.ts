import {
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";
import { AgentError } from "@/backend/error/AgentErrors";
import { isPageAgentRunStatus } from "@/definition/PageAgent";

import type { Database, DatabaseValue } from "@/backend/database/Database";
import type { PageAgentRunRecord } from "@/definition/PageAgent";

/** The prompt a step received and the moment it was handed to the model. */
export interface PinnedAgentInput {
  readonly prompt: string;
  readonly startedAt: string;
}

/** The stored texts of a plan run that ended and whose step records may still be incomplete. */
export interface UnarchivedPlanRun {
  readonly id: string;
  readonly viewJson: string;
  readonly snapshotJson: string;
}

const RECORD_COLUMNS = `
    agent_id,
    run_id,
    plan_run_id,
    user_id,
    started_at,
    finished_at,
    status,
    model,
    reasoning_effort,
    input,
    result`;

/** Durable, idempotent outbox; file failures are recoverable without rerunning a model. */
export class PageAgentRunRepository {
  private readonly database: Database;

  public constructor(database: Database) {
    this.database = database;
  }

  /** Pins the fully rendered input before any provider starts; the first pin wins. */
  public async pinInput(
    planRunId: string,
    stepId: string,
    input: PinnedAgentInput,
  ): Promise<void> {
    await this.database.execute(
      `
      INSERT INTO page_agent_run_inputs (
          plan_run_id,
          step_id,
          prompt,
          started_at
      ) VALUES (
          $plan_run_id,
          $step_id,
          $prompt,
          $started_at
      )
      ON CONFLICT DO NOTHING;
    `,
      {
        plan_run_id: planRunId,
        step_id: stepId,
        prompt: input.prompt,
        started_at: input.startedAt,
      },
    );
  }

  /** Recovery uses the exact dispatched prompt when execution reached the start boundary. */
  public async findInput(
    planRunId: string,
    stepId: string,
  ): Promise<PinnedAgentInput | null> {
    const [row] = await this.database.query(
      `
      SELECT
          prompt,
          started_at
      FROM page_agent_run_inputs
      WHERE plan_run_id = $plan_run_id
          AND step_id = $step_id;
    `,
      { plan_run_id: planRunId, step_id: stepId },
    );
    return row
      ? {
          prompt: readTextColumn(row, 0, "prompt"),
          startedAt: readTextColumn(row, 1, "started_at"),
        }
      : null;
  }

  /** The record carries the prompt from here on, so the pinned copy is not kept twice. */
  public async discardInput(planRunId: string, stepId: string): Promise<void> {
    await this.database.execute(
      `
      DELETE FROM page_agent_run_inputs
      WHERE plan_run_id = $plan_run_id
          AND step_id = $step_id;
    `,
      { plan_run_id: planRunId, step_id: stepId },
    );
  }

  /** First completion wins, including its timestamp; repeated callbacks cannot change the result. */
  public async save(record: PageAgentRunRecord): Promise<PageAgentRunRecord> {
    await this.database.execute(
      `
      INSERT INTO page_agent_run_records (
          agent_id,
          run_id,
          plan_run_id,
          user_id,
          started_at,
          finished_at,
          status,
          model,
          reasoning_effort,
          input,
          result
      ) VALUES (
          $agent_id,
          $run_id,
          $plan_run_id,
          $user_id,
          $started_at,
          $finished_at,
          $status,
          $model,
          $reasoning_effort,
          $input,
          $result
      )
      ON CONFLICT DO NOTHING;
    `,
      {
        agent_id: record.agentId,
        run_id: record.runId,
        plan_run_id: record.planRunId,
        user_id: record.userId,
        started_at: record.startedAt,
        finished_at: record.finishedAt,
        status: record.status,
        model: record.model,
        reasoning_effort: record.reasoningEffort,
        input: record.input,
        result: record.result,
      },
    );
    return this.get(record.agentId, record.runId);
  }

  /** Retrieves one private record for service authorization. */
  public async find(
    agentId: string,
    runId: string,
  ): Promise<PageAgentRunRecord | null> {
    const [row] = await this.database.query(
      `
      SELECT${RECORD_COLUMNS}
      FROM page_agent_run_records
      WHERE agent_id = $agent_id
          AND run_id = $run_id;
    `,
      { agent_id: agentId, run_id: runId },
    );
    return row ? readRecord(row) : null;
  }

  /** Retrieves a record that must exist, such as one just listed by {@link keys}. */
  public async get(
    agentId: string,
    runId: string,
  ): Promise<PageAgentRunRecord> {
    const record = await this.find(agentId, runId);
    if (!record) throw new AgentError("plan_invalid");
    return record;
  }

  /** Lists the identifiers of all records, so missing files can be found without reading their text. */
  public async keys(): Promise<
    readonly { readonly agentId: string; readonly runId: string }[]
  > {
    const rows = await this.database.query(`
      SELECT
          agent_id,
          run_id
      FROM page_agent_run_records
      ORDER BY agent_id, run_id;
    `);
    return rows.map((row) => ({
      agentId: readTextColumn(row, 0, "agent_id"),
      runId: readTextColumn(row, 1, "run_id"),
    }));
  }

  /** Remembers that every settled step of a plan run has its record and file. */
  public async markArchived(planRunId: string): Promise<void> {
    await this.database.execute(
      `
      INSERT INTO page_agent_archived_runs (plan_run_id)
      VALUES ($plan_run_id)
      ON CONFLICT DO NOTHING;
    `,
      { plan_run_id: planRunId },
    );
  }

  /**
   * Ended plan runs of this version whose records may be missing after a crash or write failure.
   *
   * @remarks
   * The texts are returned unread, so one damaged run cannot hide the others.
   */
  public async unarchived(): Promise<readonly UnarchivedPlanRun[]> {
    const rows = await this.database.query(`
      SELECT
          runs.id,
          runs.view_json,
          runs.snapshot_json
      FROM agent_plan_runs AS runs
      WHERE runs.status NOT IN ('running', 'paused')
          AND NOT EXISTS (
              SELECT 1
              FROM page_agent_archived_runs AS archived
              WHERE archived.plan_run_id = runs.id
          )
      ORDER BY runs.started_at, runs.id;
    `);
    return rows.map((row) => ({
      id: readTextColumn(row, 0, "id"),
      viewJson: readTextColumn(row, 1, "view_json"),
      snapshotJson: readTextColumn(row, 2, "snapshot_json"),
    }));
  }
}

function readRecord(row: readonly DatabaseValue[]): PageAgentRunRecord {
  const status = readTextColumn(row, 6, "status");
  if (!isPageAgentRunStatus(status)) throw new AgentError("plan_invalid");
  return {
    agentId: readTextColumn(row, 0, "agent_id"),
    runId: readTextColumn(row, 1, "run_id"),
    planRunId: readTextColumn(row, 2, "plan_run_id"),
    userId: readTextColumn(row, 3, "user_id"),
    startedAt: readTextColumn(row, 4, "started_at"),
    finishedAt: readTextColumn(row, 5, "finished_at"),
    status,
    model: readTextColumn(row, 7, "model"),
    reasoningEffort: readNullableTextColumn(row, 8, "reasoning_effort"),
    input: readTextColumn(row, 9, "input"),
    result: readTextColumn(row, 10, "result"),
  };
}
