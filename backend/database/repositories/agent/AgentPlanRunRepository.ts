import { readPlanRun } from "@/backend/agents/AgentPlanRunInput";
import { readPlanRunResources } from "@/backend/agents/AgentPlanRunResources";
import { readTextColumn } from "@/backend/database/RowValue";
import { AgentError } from "@/backend/error/AgentErrors";

import type { Database } from "@/backend/database/Database";
import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { AgentPlanSnapshot } from "@/backend/service/agents/AgentPlanSnapshot";
import type { AgentPlanRunResources } from "@/backend/agents/AgentPlanRunResources";

/** Durable sanitized run views and transactional working-copy reservations. */
export class AgentPlanRunRepository {
  private readonly database: Database;

  public constructor(database: Database) {
    this.database = database;
  }

  /** Rejects stale Play requests and reserves all writing directories before any starts. */
  public async create(
    run: AgentPlanRun,
    snapshot: AgentPlanSnapshot,
    workspaceIds: readonly string[],
  ): Promise<void> {
    await this.database.transaction(async (transaction) => {
      const [plan] = await transaction.query(
        "SELECT revision FROM agent_plans WHERE id = $id;",
        { id: run.planId },
      );
      if (!plan || Number(plan[0]) !== run.planRevision)
        throw new AgentError("plan_conflict");
      for (const workspaceId of new Set(workspaceIds)) {
        const [lock] = await transaction.query(
          "SELECT run_id FROM agent_plan_workspace_locks WHERE workspace_id = $id;",
          { id: workspaceId },
        );
        if (lock) throw new AgentError("plan_workspace_conflict");
        await transaction.execute(
          `
          INSERT INTO agent_plan_workspace_locks (workspace_id, run_id)
          VALUES ($workspace_id, $run_id);
        `,
          { workspace_id: workspaceId, run_id: run.id },
        );
      }
      await transaction.execute(
        `
        INSERT INTO agent_plan_runs (
            id,
            plan_id,
            user_id,
            project_id,
            workspace_id,
            started_at,
            status,
            view_json,
            snapshot_json
        ) VALUES ($id, $plan_id, $user_id, $project_id, $workspace_id, $started_at, $status, $view_json, $snapshot_json);
      `,
        {
          id: run.id,
          plan_id: run.planId,
          user_id: run.userId,
          project_id: snapshot.plan.projectId,
          workspace_id: snapshot.plan.workspaceId,
          started_at: run.startedAt,
          status: run.status,
          view_json: JSON.stringify(run),
          snapshot_json: JSON.stringify(snapshot),
        },
      );
    });
  }

  /** Reads only the public record; service authorization still precedes delivery. */
  public async find(id: string): Promise<AgentPlanRun | null> {
    const [row] = await this.database.query(
      "SELECT view_json FROM agent_plan_runs WHERE id = $id;",
      { id },
    );
    const input: unknown = row
      ? JSON.parse(readTextColumn(row, 0, "view_json"))
      : null;
    return input === null ? null : readPlanRun(input);
  }

  /** Keeps private snapshot content off the read API while exposing references for live authorization. */
  public async resources(id: string): Promise<AgentPlanRunResources> {
    const [row] = await this.database.query(
      "SELECT snapshot_json FROM agent_plan_runs WHERE id = $id;",
      { id },
    );
    if (!row) throw new AgentError("plan_access_denied");
    const snapshot: unknown = JSON.parse(
      readTextColumn(row, 0, "snapshot_json"),
    );
    return readPlanRunResources(snapshot);
  }

  /** Returns unfinished public records for service-controlled recovery after restart. */
  public async unfinished(): Promise<readonly AgentPlanRun[]> {
    const rows = await this.database.query(
      "SELECT view_json FROM agent_plan_runs WHERE status = 'running';",
    );
    return rows.map((row) => {
      const input: unknown = JSON.parse(readTextColumn(row, 0, "view_json"));
      return readPlanRun(input);
    });
  }

  /** Persists interrupted progress while retaining reservations for unknown processes. */
  public async interrupt(run: AgentPlanRun): Promise<void> {
    await this.database.execute(
      `
        UPDATE agent_plan_runs
        SET status = $status,
            view_json = $view_json
        WHERE id = $id
            AND status = 'running';
      `,
      { id: run.id, status: run.status, view_json: JSON.stringify(run) },
    );
  }

  /** History is restricted to the executor and the latest twenty runs of the selected plan. */
  public async list(
    userId: string,
    planId: string,
  ): Promise<readonly AgentPlanRun[]> {
    const rows = await this.database.query(
      `
      SELECT view_json
      FROM agent_plan_runs
      WHERE user_id = $user_id
          AND plan_id = $plan_id
      ORDER BY started_at DESC, id DESC
      LIMIT 20;
    `,
      { user_id: userId, plan_id: planId },
    );
    return rows.map((row) => {
      const input: unknown = JSON.parse(readTextColumn(row, 0, "view_json"));
      return readPlanRun(input);
    });
  }

  /** Stores progress and releases reservations only after every started step has settled. */
  public async update(run: AgentPlanRun): Promise<void> {
    await this.database.transaction(async (transaction) => {
      await transaction.execute(
        `
        UPDATE agent_plan_runs
        SET status = $status,
            view_json = $view_json
        WHERE id = $id;
      `,
        { id: run.id, status: run.status, view_json: JSON.stringify(run) },
      );
      if (run.status !== "running")
        await transaction.execute(
          "DELETE FROM agent_plan_workspace_locks WHERE run_id = $id;",
          { id: run.id },
        );
    });
  }
}
