import { readAgentObject } from "@/backend/agents/AgentPayload";
import { readPlanRun } from "@/backend/agents/AgentPlanRunInput";
import { readPlanWorkRecord } from "@/backend/agents/AgentPlanWorkInput";
import { readTextColumn } from "@/backend/database/RowValue";

import { CURRENT_PLAN_SNAPSHOT } from "./AgentPlanContinuationRepository";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { AgentPlanWorkRecord } from "@/definition/AgentPlanWork";

/** Every scope is bound to an actual run, node, attempt and ticket. */
export interface PlanWorkKey {
  readonly runId: string;
  readonly stepId: string;
  readonly attemptId: string;
  readonly ticketId: string;
}

/** Append-only work scope and evidence, using the caller's existing transaction. */
export class AgentPlanWorkRepository {
  private readonly database: DatabaseTransaction;

  public constructor(database: DatabaseTransaction) {
    this.database = database;
  }

  /** Reads the current durable run and latest adopted execution basis. */
  public async basis(runId: string): Promise<{
    readonly run: AgentPlanRun;
    readonly snapshot: Record<string, unknown>;
  } | null> {
    const [row] = await this.database.query(
      `
      SELECT
          view_json,
          ${CURRENT_PLAN_SNAPSHOT} AS snapshot_json
      FROM agent_plan_runs
      WHERE id = $id;
    `,
      { id: runId },
    );
    if (!row) return null;
    return {
      run: readPlanRun(JSON.parse(readTextColumn(row, 0, "view_json"))),
      snapshot: readAgentObject(
        JSON.parse(readTextColumn(row, 1, "snapshot_json")),
      ),
    };
  }

  /** Returns the last immutable revision of exactly this attempt. */
  public async find(key: PlanWorkKey): Promise<AgentPlanWorkRecord | null> {
    const [row] = await this.database.query(
      `
      SELECT record_json
      FROM agent_plan_work
      WHERE run_id = $runId
          AND step_id = $stepId
          AND attempt_id = $attemptId
          AND ticket_id = $ticketId
      ORDER BY revision DESC
      LIMIT 1;
    `,
      { ...key },
    );
    return row
      ? readPlanWorkRecord(JSON.parse(readTextColumn(row, 0, "record_json")))
      : null;
  }

  /** Appends after the service has checked the expected revision inside the same transaction. */
  public async insert(
    key: PlanWorkKey,
    record: AgentPlanWorkRecord,
  ): Promise<void> {
    await this.database.execute(
      `
      INSERT INTO agent_plan_work (
          run_id,
          step_id,
          attempt_id,
          ticket_id,
          revision,
          record_json
      )
      VALUES (
          $runId,
          $stepId,
          $attemptId,
          $ticketId,
          $revision,
          $record
      );
    `,
      { ...key, revision: record.revision, record: JSON.stringify(record) },
    );
  }
}
