import { readPlanRun } from "@/backend/agents/AgentPlanRunInput";
import { readTextColumn } from "@/backend/database/RowValue";
import { AgentError } from "@/backend/error/AgentErrors";

import type {
  Database,
  DatabaseTransaction,
} from "@/backend/database/Database";
import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { AgentPlanSnapshot } from "@/backend/service/agents/AgentPlanSnapshot";

/** Fixed SQL expression for the current execution basis, with legacy snapshot fallback. */
export const CURRENT_PLAN_SNAPSHOT = `COALESCE((
    SELECT continuation.snapshot_json
    FROM agent_plan_continuations AS continuation
    WHERE continuation.run_id = agent_plan_runs.id
    ORDER BY continuation.version DESC
    LIMIT 1
), snapshot_json)`;

/** The prepared continuation and the exact paused view it must replace atomically. */
export interface PlanContinuationWrite {
  readonly previous: AgentPlanRun;
  readonly run: AgentPlanRun;
  readonly snapshot: AgentPlanSnapshot;
  readonly workspaceIds: readonly string[];
}

/** Append-only continuation bases; adoption never overwrites a past snapshot or result. */
export class AgentPlanContinuationRepository {
  private readonly database: Pick<Database, "transaction" | "query">;

  public constructor(database: Pick<Database, "transaction" | "query">) {
    this.database = database;
  }

  /** Compares the paused boundary and plan revision before adopting and reserving new work. */
  public async adopt(input: PlanContinuationWrite): Promise<void> {
    await this.database.transaction(async (transaction) => {
      await this.requireCurrent(transaction, input);
      await this.reserve(transaction, input);
      const { run, snapshot, previous } = input;
      const continuation = run.continuation;
      if (!continuation || !previous.pauseBoundary)
        throw new AgentError("plan_run_unavailable");
      await transaction.execute(
        `
        INSERT INTO agent_plan_continuations (
            run_id,
            version,
            plan_revision,
            adopted_at,
            boundary_json,
            snapshot_json
        ) VALUES ($id, $version, $plan_revision, $adopted_at, $boundary, $snapshot);
      `,
        {
          id: run.id,
          version: continuation.version,
          plan_revision: snapshot.plan.revision,
          adopted_at: continuation.adoptedAt,
          boundary: JSON.stringify(previous.pauseBoundary),
          snapshot: JSON.stringify(snapshot),
        },
      );
      await transaction.execute(
        `
        UPDATE agent_plan_runs
        SET status = $status,
            view_json = $view,
            recovery_revision = recovery_revision + 1
        WHERE id = $id;
      `,
        { id: run.id, status: run.status, view: JSON.stringify(run) },
      );
    });
  }

  /** Returns every basis for authorization, newest first; historical results stay protected. */
  public async snapshots(id: string): Promise<readonly unknown[]> {
    const rows = await this.database.query(
      `
      SELECT snapshot_json
      FROM (
          SELECT snapshot_json, version
          FROM agent_plan_continuations
          WHERE run_id = $id
          UNION ALL
          SELECT snapshot_json, 0 AS version
          FROM agent_plan_runs
          WHERE id = $id
      ) AS bases
      ORDER BY version DESC;
    `,
      { id },
    );
    return rows.map(
      (row) => JSON.parse(readTextColumn(row, 0, "snapshot_json")) as unknown,
    );
  }

  private async requireCurrent(
    transaction: DatabaseTransaction,
    input: PlanContinuationWrite,
  ): Promise<void> {
    const [stored] = await transaction.query(
      `
      SELECT view_json
      FROM agent_plan_runs
      WHERE id = $id;
    `,
      { id: input.run.id },
    );
    if (!stored) throw new AgentError("plan_run_unavailable");
    const current = readPlanRun(
      JSON.parse(readTextColumn(stored, 0, "view_json")),
    );
    if (
      current.status !== "paused" ||
      current.stopRequested ||
      JSON.stringify(current) !== JSON.stringify(readPlanRun(input.previous))
    )
      throw new AgentError("plan_conflict");
    const [plan] = await transaction.query(
      `
      SELECT revision
      FROM agent_plans
      WHERE id = $id;
    `,
      { id: current.planId },
    );
    if (!plan || Number(plan[0]) !== input.snapshot.plan.revision)
      throw new AgentError("plan_conflict");
  }

  private async reserve(
    transaction: DatabaseTransaction,
    input: PlanContinuationWrite,
  ): Promise<void> {
    for (const id of new Set(input.workspaceIds)) {
      const [lock] = await transaction.query(
        `
        SELECT run_id
        FROM agent_plan_workspace_locks
        WHERE workspace_id = $id;
      `,
        { id },
      );
      if (lock && lock[0] !== input.run.id)
        throw new AgentError("plan_workspace_conflict");
      if (!lock)
        await transaction.execute(
          `
        INSERT INTO agent_plan_workspace_locks (workspace_id, run_id)
        VALUES ($id, $run_id);
      `,
          { id, run_id: input.run.id },
        );
    }
  }
}
