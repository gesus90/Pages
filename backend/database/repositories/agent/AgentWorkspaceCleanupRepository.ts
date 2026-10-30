import { readTextColumn } from "@/backend/database/RowValue";

import type { DatabaseValue } from "@/backend/database/Database";
import type { Database } from "@/backend/database/Database";
import type { AgentWorkspaceCleanup } from "@/definition/AgentWorkspaceCleanup";

function readCleanup(row: readonly DatabaseValue[]): AgentWorkspaceCleanup {
  return {
    workspaceId: readTextColumn(row, 0, "workspace_id"),
    workspaceName: readTextColumn(row, 1, "workspace_name"),
    runId: readTextColumn(row, 2, "run_id"),
    ownerId: readTextColumn(row, 3, "owner_id"),
    blocker: readTextColumn(row, 4, "blocker"),
    updatedAt: readTextColumn(row, 5, "updated_at"),
  };
}

/** Durable cleanup obligations survive logical registration removal and server restarts. */
export class AgentWorkspaceCleanupRepository {
  private readonly database: Pick<Database, "query" | "execute">;

  public constructor(database: Pick<Database, "query" | "execute">) {
    this.database = database;
  }

  /** Returns the oldest pending owners first; no job identity is reconstructed from a path. */
  public async pending(): Promise<readonly AgentWorkspaceCleanup[]> {
    const rows = await this.database.query(`
      SELECT workspace_id, workspace_name, run_id, owner_id, blocker, updated_at
      FROM agent_workspace_cleanup
      WHERE state = 'pending'
      ORDER BY updated_at, workspace_id, run_id
      LIMIT 100;
    `);
    return rows.map(readCleanup);
  }

  /** Records actual cleanup progress; completed requires independently proven process freedom. */
  public async record(
    entry: AgentWorkspaceCleanup,
    state: "pending" | "completed",
    blocker: string,
  ): Promise<void> {
    await this.database.execute(
      `
      UPDATE agent_workspace_cleanup
      SET state = $state, blocker = $blocker, updated_at = utc_now()
      WHERE workspace_id = $workspace_id AND run_id = $run_id AND owner_id = $owner_id;
    `,
      {
        workspace_id: entry.workspaceId,
        run_id: entry.runId,
        owner_id: entry.ownerId,
        state,
        blocker,
      },
    );
  }

  /** Lists only the executor's own obligations for this visible plan. */
  public async forPlan(
    userId: string,
    planId: string,
  ): Promise<readonly AgentWorkspaceCleanup[]> {
    const rows = await this.database.query(
      `
      SELECT cleanup.workspace_id, cleanup.workspace_name, cleanup.run_id, cleanup.owner_id, cleanup.blocker, cleanup.updated_at
      FROM agent_workspace_cleanup AS cleanup
      INNER JOIN agent_plan_runs AS runs ON runs.id = cleanup.run_id
      WHERE cleanup.state = 'pending' AND cleanup.owner_id = $user_id AND runs.plan_id = $plan_id
      ORDER BY cleanup.updated_at, cleanup.workspace_id, cleanup.run_id;
    `,
      { user_id: userId, plan_id: planId },
    );
    return rows.map(readCleanup);
  }
}
