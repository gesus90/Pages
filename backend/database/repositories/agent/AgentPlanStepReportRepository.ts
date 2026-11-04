import {
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";

import type { Database } from "@/backend/database/Database";

/** The session credential a slot belongs to: its run and its node or group. */
export interface PlanStepReportScope {
  readonly runId: string;
  readonly sessionScopeId: string;
}

/** The attempt that may report through one session credential now. */
export interface PlanStepReportSlot extends PlanStepReportScope {
  readonly stepId: string;
  readonly attemptId: string;
  readonly termsJson: string;
}

/** A slot and the report it holds, as stored. */
export interface StoredPlanStepReport extends PlanStepReportSlot {
  readonly reportJson: string | null;
}

/** Stores the open report slots of running turns. */
export class AgentPlanStepReportRepository {
  private readonly database: Pick<Database, "query" | "execute">;

  public constructor(database: Pick<Database, "query" | "execute">) {
    this.database = database;
  }

  /** Opens the slot of a turn; only the attempt that already held it keeps its report, as after a restart. */
  public async open(slot: PlanStepReportSlot): Promise<void> {
    await this.database.execute(
      `
      INSERT INTO agent_plan_step_reports (
          run_id,
          session_scope_id,
          step_id,
          attempt_id,
          terms_json,
          report_json
      )
      VALUES (
          $run_id,
          $session_scope_id,
          $step_id,
          $attempt_id,
          $terms_json,
          NULL
      )
      ON CONFLICT (run_id, session_scope_id) DO UPDATE SET
          step_id = excluded.step_id,
          attempt_id = excluded.attempt_id,
          terms_json = excluded.terms_json,
          report_json = CASE
              WHEN agent_plan_step_reports.attempt_id = excluded.attempt_id
                  THEN agent_plan_step_reports.report_json
              ELSE NULL
          END;
    `,
      {
        run_id: slot.runId,
        session_scope_id: slot.sessionScopeId,
        step_id: slot.stepId,
        attempt_id: slot.attemptId,
        terms_json: slot.termsJson,
      },
    );
  }

  /** Finds the open slot of a session credential. */
  public async find(
    scope: PlanStepReportScope,
  ): Promise<StoredPlanStepReport | null> {
    const [row] = await this.database.query(
      `
      SELECT
          step_id,
          attempt_id,
          terms_json,
          report_json
      FROM agent_plan_step_reports
      WHERE run_id = $run_id
          AND session_scope_id = $session_scope_id;
    `,
      { run_id: scope.runId, session_scope_id: scope.sessionScopeId },
    );
    if (!row) return null;
    return {
      ...scope,
      stepId: readTextColumn(row, 0, "step_id"),
      attemptId: readTextColumn(row, 1, "attempt_id"),
      termsJson: readTextColumn(row, 2, "terms_json"),
      reportJson: readNullableTextColumn(row, 3, "report_json"),
    };
  }

  /**
   * Sets or replaces the report of exactly this attempt.
   *
   * @returns Whether the attempt still held the slot.
   */
  public async save(
    slot: Pick<PlanStepReportSlot, "runId" | "sessionScopeId" | "attemptId">,
    reportJson: string,
  ): Promise<boolean> {
    const rows = await this.database.query(
      `
      UPDATE agent_plan_step_reports
      SET report_json = $report_json
      WHERE run_id = $run_id
          AND session_scope_id = $session_scope_id
          AND attempt_id = $attempt_id
      RETURNING attempt_id;
    `,
      {
        run_id: slot.runId,
        session_scope_id: slot.sessionScopeId,
        attempt_id: slot.attemptId,
        report_json: reportJson,
      },
    );
    return rows.length > 0;
  }

  /**
   * Closes the slot of an attempt, so a late call cannot change the assessed result.
   *
   * @returns The report it held; `null` without a report or without a slot of this attempt.
   */
  public async close(
    slot: Pick<PlanStepReportSlot, "runId" | "sessionScopeId" | "attemptId">,
  ): Promise<string | null> {
    const [row] = await this.database.query(
      `
      DELETE FROM agent_plan_step_reports
      WHERE run_id = $run_id
          AND session_scope_id = $session_scope_id
          AND attempt_id = $attempt_id
      RETURNING report_json;
    `,
      {
        run_id: slot.runId,
        session_scope_id: slot.sessionScopeId,
        attempt_id: slot.attemptId,
      },
    );
    return row ? readNullableTextColumn(row, 0, "report_json") : null;
  }
}
