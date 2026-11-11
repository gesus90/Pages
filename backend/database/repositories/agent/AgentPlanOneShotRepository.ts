import { randomUUID } from "node:crypto";

import {
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";
import { ProjectActivityRepository } from "@/backend/database/repositories/project/ProjectActivityRepository";

import type {
  Database,
  DatabaseTransaction,
} from "@/backend/database/Database";

/** The facts a deletion decides on, read before anything is removed. */
export interface OneShotPlanCandidate {
  readonly planId: string;
  readonly name: string;
  readonly ownerId: string;
  readonly projectId: string;
  /** When the deletion falls due, an ISO 8601 UTC time; `null` while none is scheduled. */
  readonly deletionAt: string | null;
  readonly isOneShot: boolean;
  /** Whether a run still executes steps or waits at a pause. */
  readonly hasActiveRun: boolean;
  /** The status of the newest run, `null` without runs. */
  readonly latestRunStatus: string | null;
}

/** What the activity log records when a one-time plan goes. */
export interface OneShotDeletionEntry {
  readonly planId: string;
  readonly ownerId: string;
  readonly projectId: string;
  readonly planName: string;
}

const PLAN_ROW = `
  SELECT
      id,
      name,
      owner_id,
      project_id,
      one_shot_delete_at,
      json_extract_string(plan_json, '$.oneShot') AS one_shot
  FROM agent_plans
  WHERE id = $plan_id
`;

const ACTIVE_RUN = `
  SELECT id
  FROM agent_plan_runs
  WHERE plan_id = $plan_id
      AND status IN ('running', 'pausing', 'paused', 'stopping')
  LIMIT 1;
`;

const LATEST_RUN = `
  SELECT status
  FROM agent_plan_runs
  WHERE plan_id = $plan_id
  ORDER BY creation_order DESC NULLS LAST, started_at DESC, id DESC
  LIMIT 1;
`;

/** The message of the one entry the activity log keeps of a deleted one-time plan. */
function deletionMessage(planName: string, ownerName: string): string {
  return `Einmal-Plan "${planName}" nach erfolgreichem Lauf gelöscht (Eigentümer: ${ownerName}).`;
}

/**
 * Persists the deadline of one-time plans and carries out their final deletion.
 *
 * @remarks
 * The one-time mark is part of the stored plan graph; this repository owns
 * only the deadline column and the last transaction of a deletion. The rows
 * of the runs are removed beforehand by `purgeAllPlanRuns`.
 */
export class AgentPlanOneShotRepository {
  private readonly database: Pick<Database, "transaction" | "query">;

  public constructor(database: Pick<Database, "transaction" | "query">) {
    this.database = database;
  }

  /**
   * Sets the deadline of a plan that carries the one-time mark.
   *
   * @param planId - The plan whose run just succeeded.
   * @param deletionAt - The deadline, an ISO 8601 UTC time.
   * @returns Whether the plan is a one-time plan and now has the deadline.
   */
  public async schedule(planId: string, deletionAt: string): Promise<boolean> {
    return this.database.transaction(async (transaction) => {
      const rows = await transaction.query(
        `
          UPDATE agent_plans
          SET one_shot_delete_at = $deletion_at
          WHERE id = $plan_id
              AND json_extract_string(plan_json, '$.oneShot') = 'true'
          RETURNING id;
        `,
        { plan_id: planId, deletion_at: deletionAt },
      );
      return rows.length > 0;
    });
  }

  /** Cancels a scheduled deletion; the mark stays. */
  public async cancel(planId: string): Promise<void> {
    await this.database.transaction((transaction) =>
      transaction.execute(
        `
          UPDATE agent_plans
          SET one_shot_delete_at = NULL
          WHERE id = $plan_id
              AND one_shot_delete_at IS NOT NULL;
        `,
        { plan_id: planId },
      ),
    );
  }

  /**
   * Lists the plans whose deletion is due.
   *
   * @param now - The current time, an ISO 8601 UTC time.
   * @returns The plan identifiers, the earliest deadline first.
   */
  public async listDue(now: string): Promise<readonly string[]> {
    const rows = await this.database.query(
      `
        SELECT id
        FROM agent_plans
        WHERE one_shot_delete_at IS NOT NULL
            AND one_shot_delete_at <= $now
        ORDER BY one_shot_delete_at, id;
      `,
      { now },
    );
    return rows.map((row) => readTextColumn(row, 0, "id"));
  }

  /** Reads what a deletion decides on; `null` when the plan is gone. */
  public async findCandidate(
    planId: string,
  ): Promise<OneShotPlanCandidate | null> {
    const [plan] = await this.database.query(`${PLAN_ROW};`, {
      plan_id: planId,
    });
    if (!plan) return null;
    const [active] = await this.database.query(ACTIVE_RUN, {
      plan_id: planId,
    });
    const [latest] = await this.database.query(LATEST_RUN, {
      plan_id: planId,
    });
    return {
      planId,
      name: readTextColumn(plan, 1, "name"),
      ownerId: readTextColumn(plan, 2, "owner_id"),
      projectId: readTextColumn(plan, 3, "project_id"),
      deletionAt: readNullableTextColumn(plan, 4, "one_shot_delete_at"),
      isOneShot: readNullableTextColumn(plan, 5, "one_shot") === "true",
      hasActiveRun: active !== undefined,
      latestRunStatus: latest ? readTextColumn(latest, 0, "status") : null,
    };
  }

  /**
   * Deletes the plan and writes the one log entry, in one transaction.
   *
   * @param planId - The plan that goes.
   * @returns `deleted`; `not_due` when the plan was kept, changed or got a new
   * run since the check, in which case nothing was changed; `gone` when it
   * does not exist any more.
   *
   * @remarks
   * Runs, revisions and parameters belong to the plan row or were removed
   * before; a run that appeared in the meantime keeps the plan.
   */
  public async deletePlan(
    planId: string,
  ): Promise<"deleted" | "not_due" | "gone"> {
    return this.database.transaction(async (transaction) => {
      const [locked] = await transaction.query(`${PLAN_ROW} FOR UPDATE;`, {
        plan_id: planId,
      });
      if (!locked) return "gone";
      const isMarked =
        readNullableTextColumn(locked, 5, "one_shot") === "true" &&
        readNullableTextColumn(locked, 4, "one_shot_delete_at") !== null;
      const [run] = await transaction.query(
        "SELECT id FROM agent_plan_runs WHERE plan_id = $plan_id LIMIT 1;",
        { plan_id: planId },
      );
      if (!isMarked || run) return "not_due";
      await this.removePlan(transaction, {
        planId,
        planName: readTextColumn(locked, 1, "name"),
        ownerId: readTextColumn(locked, 2, "owner_id"),
        projectId: readTextColumn(locked, 3, "project_id"),
      });
      return "deleted";
    });
  }

  private async removePlan(
    transaction: DatabaseTransaction,
    entry: OneShotDeletionEntry,
  ): Promise<void> {
    await transaction.execute(
      "DELETE FROM agent_plan_start_rejections WHERE plan_id = $plan_id;",
      { plan_id: entry.planId },
    );
    await transaction.execute("DELETE FROM agent_plans WHERE id = $plan_id;", {
      plan_id: entry.planId,
    });
    const [owner] = await transaction.query(
      "SELECT display_name FROM users WHERE id = $owner_id;",
      { owner_id: entry.ownerId },
    );
    const ownerName = owner ? readTextColumn(owner, 0, "display_name") : "?";
    await new ProjectActivityRepository(transaction, "ui").insert({
      id: randomUUID(),
      projectId: entry.projectId,
      userId: entry.ownerId,
      category: "project",
      action: "one_shot_plan_deleted",
      message: deletionMessage(entry.planName, ownerName),
    });
  }
}
