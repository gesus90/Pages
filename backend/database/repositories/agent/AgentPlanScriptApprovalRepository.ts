import { readTextColumn } from "@/backend/database/RowValue";

import type { DatabaseTransaction } from "@/backend/database/Database";

/** The approved hash of one script step. */
export interface AgentPlanScriptApproval {
  readonly stepId: string;
  readonly contentHash: string;
  readonly approvedBy: string;
  readonly approvedAt: string;
}

/**
 * Stores which script content an administrator approved (PAGE-329, part C).
 *
 * @remarks
 * One approval per script step, bound to the hash of script, interpreter
 * profile and workspace. A changed script has another hash, so the stored
 * approval no longer matches; nothing has to be revoked explicitly.
 */
export class AgentPlanScriptApprovalRepository {
  private readonly database: Pick<DatabaseTransaction, "query" | "execute">;

  public constructor(database: Pick<DatabaseTransaction, "query" | "execute">) {
    this.database = database;
  }

  /** Reads the approvals of a plan by step. */
  public async list(
    planId: string,
  ): Promise<ReadonlyMap<string, AgentPlanScriptApproval>> {
    const rows = await this.database.query(
      `
      SELECT
          step_id,
          content_hash,
          approved_by,
          approved_at
      FROM agent_plan_script_approvals
      WHERE plan_id = $plan_id;
    `,
      { plan_id: planId },
    );
    return new Map(
      rows.map((row) => {
        const approval = {
          stepId: readTextColumn(row, 0, "step_id"),
          contentHash: readTextColumn(row, 1, "content_hash"),
          approvedBy: readTextColumn(row, 2, "approved_by"),
          approvedAt: readTextColumn(row, 3, "approved_at"),
        };
        return [approval.stepId, approval];
      }),
    );
  }

  /** Stores the approval of one step, replacing an earlier one. */
  public async approve(
    planId: string,
    approval: Omit<AgentPlanScriptApproval, "approvedAt">,
  ): Promise<void> {
    await this.database.execute(
      `
      INSERT INTO agent_plan_script_approvals (
          plan_id,
          step_id,
          content_hash,
          approved_by,
          approved_at
      )
      VALUES (
          $plan_id,
          $step_id,
          $content_hash,
          $approved_by,
          $approved_at
      )
      ON CONFLICT (plan_id, step_id) DO UPDATE SET
          content_hash = EXCLUDED.content_hash,
          approved_by = EXCLUDED.approved_by,
          approved_at = EXCLUDED.approved_at;
    `,
      {
        plan_id: planId,
        step_id: approval.stepId,
        content_hash: approval.contentHash,
        approved_by: approval.approvedBy,
        approved_at: new Date().toISOString(),
      },
    );
  }
}
