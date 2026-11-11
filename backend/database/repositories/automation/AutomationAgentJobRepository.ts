import {
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";
import {
  AUTOMATION_DELIVERY_KINDS,
  AUTOMATION_DELIVERY_STATES,
} from "@/definition/Automation";

import type {
  Database,
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";
import type {
  AutomationDeliveryKind,
  AutomationDeliveryState,
} from "@/definition/Automation";

/** One delivery of a run to an agent. */
export interface StoredAutomationAgentJob {
  readonly id: string;
  readonly runId: string | null;
  readonly automationId: string | null;
  readonly agentId: string;
  readonly creatorId: string;
  readonly kind: AutomationDeliveryKind;
  readonly prompt: string;
  readonly state: AutomationDeliveryState;
  readonly answer: string | null;
  readonly errorCode: string | null;
  readonly sessionId: string | null;
  readonly queuedAt: string;
  readonly deliveredAt: string | null;
  readonly completedAt: string | null;
}

/** A new delivery that waits in the agent's queue. */
export interface AutomationAgentJobRequest {
  readonly id: string;
  readonly runId: string | null;
  readonly automationId: string | null;
  readonly agentId: string;
  readonly creatorId: string;
  readonly kind: AutomationDeliveryKind;
  readonly prompt: string;
  readonly queuedAt: string;
}

type Executor = Pick<Database, "query" | "execute"> | DatabaseTransaction;

const COLUMNS = `
    automation_agent_jobs.id,
    automation_agent_jobs.automation_run_id,
    automation_agent_jobs.automation_id,
    automation_agent_jobs.agent_id,
    automation_agent_jobs.creator_id,
    automation_agent_jobs.kind,
    automation_agent_jobs.prompt,
    automation_agent_jobs.state,
    automation_agent_jobs.answer,
    automation_agent_jobs.error_code,
    automation_agent_jobs.session_id,
    automation_agent_jobs.queued_at,
    automation_agent_jobs.delivered_at,
    automation_agent_jobs.completed_at`;

function readJobRow(row: readonly DatabaseValue[]): StoredAutomationAgentJob {
  const text = (index: number, name: string): string | null =>
    readNullableTextColumn(row, index, name);
  return {
    id: readTextColumn(row, 0, "id"),
    runId: text(1, "automation_run_id"),
    automationId: text(2, "automation_id"),
    agentId: readTextColumn(row, 3, "agent_id"),
    creatorId: readTextColumn(row, 4, "creator_id"),
    kind:
      AUTOMATION_DELIVERY_KINDS.find((kind) => kind === text(5, "kind")) ??
      "action",
    prompt: readTextColumn(row, 6, "prompt"),
    state:
      AUTOMATION_DELIVERY_STATES.find((state) => state === text(7, "state")) ??
      "failed",
    answer: text(8, "answer"),
    errorCode: text(9, "error_code"),
    sessionId: text(10, "session_id"),
    queuedAt: readTextColumn(row, 11, "queued_at"),
    deliveredAt: text(12, "delivered_at"),
    completedAt: text(13, "completed_at"),
  };
}

/**
 * The queue of every agent (PAGE-297).
 *
 * @remarks
 * Deliveries of one agent start in the order they arrived; one run delivers
 * to one agent at most once per kind.
 */
export class AutomationAgentJobRepository {
  private readonly database: Executor;

  /**
   * Creates the repository.
   *
   * @param database - The database or an open transaction.
   */
  public constructor(database: Executor) {
    this.database = database;
  }

  /**
   * Adds a delivery to the agent's queue.
   *
   * @returns Whether it was added; a second delivery of the same run, agent and kind is not.
   */
  public async enqueue(request: AutomationAgentJobRequest): Promise<boolean> {
    const rows = await this.database.query(
      `
      INSERT INTO automation_agent_jobs (
          id,
          automation_run_id,
          automation_id,
          agent_id,
          creator_id,
          kind,
          prompt,
          state,
          queued_at
      )
      VALUES (
          $id,
          $automation_run_id,
          $automation_id,
          $agent_id,
          $creator_id,
          $kind,
          $prompt,
          'queued',
          $queued_at
      )
      ON CONFLICT (automation_run_id, agent_id, kind) DO NOTHING
      RETURNING id;
    `,
      {
        id: request.id,
        automation_run_id: request.runId,
        automation_id: request.automationId,
        agent_id: request.agentId,
        creator_id: request.creatorId,
        kind: request.kind,
        prompt: request.prompt,
        queued_at: request.queuedAt,
      },
    );
    return rows.length > 0;
  }

  /** The first waiting delivery of every agent that is not busy with one. */
  public async heads(): Promise<readonly StoredAutomationAgentJob[]> {
    const rows = await this.database.query(
      `
      SELECT DISTINCT ON (automation_agent_jobs.agent_id) ${COLUMNS}
      FROM automation_agent_jobs
      WHERE automation_agent_jobs.state = 'queued'
          AND NOT EXISTS (
              SELECT 1
              FROM automation_agent_jobs AS busy
              WHERE busy.agent_id = automation_agent_jobs.agent_id
                  AND busy.state = 'delivered'
          )
      ORDER BY automation_agent_jobs.agent_id, automation_agent_jobs.sequence;
    `,
    );
    return rows.map(readJobRow);
  }

  /**
   * Marks a waiting delivery as started.
   *
   * @returns Whether this caller started it.
   */
  public async deliver(
    jobId: string,
    sessionId: string | null,
    deliveredAt: string,
  ): Promise<boolean> {
    const rows = await this.database.query(
      `
      UPDATE automation_agent_jobs
      SET
          state = 'delivered',
          session_id = $session_id,
          delivered_at = $delivered_at
      WHERE id = $id
          AND state = 'queued'
      RETURNING id;
    `,
      { id: jobId, session_id: sessionId, delivered_at: deliveredAt },
    );
    return rows.length > 0;
  }

  /** Ends a delivery with the agent's answer or a failure code. */
  public async finish(
    jobId: string,
    ending: {
      readonly state: "completed" | "failed";
      readonly answer: string | null;
      readonly errorCode: string | null;
      readonly completedAt: string;
    },
  ): Promise<void> {
    await this.database.execute(
      `
      UPDATE automation_agent_jobs
      SET
          state = $state,
          answer = $answer,
          error_code = $error_code,
          completed_at = $completed_at
      WHERE id = $id
          AND state IN ('queued', 'delivered');
    `,
      {
        id: jobId,
        state: ending.state,
        answer: ending.answer,
        error_code: ending.errorCode,
        completed_at: ending.completedAt,
      },
    );
  }

  /** Every delivery of runs, oldest first. */
  public async forRuns(
    runIds: readonly string[],
  ): Promise<readonly StoredAutomationAgentJob[]> {
    if (runIds.length === 0) return [];
    const rows = await this.database.query(
      `
      SELECT ${COLUMNS}
      FROM automation_agent_jobs
      WHERE automation_agent_jobs.automation_run_id = ANY(string_to_array($automation_run_ids, ','))
      ORDER BY automation_agent_jobs.sequence;
    `,
      { automation_run_ids: runIds.join(",") },
    );
    return rows.map(readJobRow);
  }

  /** The deliveries that were started by a process that ended since. */
  public async interrupted(): Promise<readonly StoredAutomationAgentJob[]> {
    const rows = await this.database.query(
      `
      SELECT ${COLUMNS}
      FROM automation_agent_jobs
      WHERE automation_agent_jobs.state = 'delivered'
      ORDER BY automation_agent_jobs.sequence;
    `,
    );
    return rows.map(readJobRow);
  }

  /** Removes ended deliveries older than a time. */
  public async pruneEnded(before: string): Promise<void> {
    await this.database.execute(
      `
      DELETE FROM automation_agent_jobs
      WHERE state IN ('completed', 'failed')
          AND completed_at < $before
          AND automation_run_id IS NULL;
    `,
      { before },
    );
  }
}
